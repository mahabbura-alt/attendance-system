#!/usr/bin/env python3
"""
OMOS — pasang / perbarui konfigurasi AGEN LLM di server Biznet secara otomatis.

Jalankan dari LAPTOP (bukan di server):
    python deploy_llm_agent.py --dry-run     # lihat apa yang akan dilakukan (key disamarkan)
    python deploy_llm_agent.py               # jalankan sungguhan
    python deploy_llm_agent.py --restart     # + jalankan RESTART_COMMAND di bawah

Yang dilakukan (idempoten, aman diulang):
  1. Validasi isian (https, host ada di allowlist, model terisi).
  2. Menulis /opt/omos/secrets/llm_api_key  (mode 0400, pemilik uid container) — atomik.
  3. Backup app.env -> app.env.bak.<waktu>, lalu set/ganti baris LLM_* (baris lain tidak disentuh).
  4. Uji: host terjangkau + 1 panggilan kecil ke model (key dikirim lewat stdin, bukan argumen).
  5. (opsional) unggah berkas lokal ke server (UPLOADS) dan jalankan perintah restart.

Keamanan:
  - API key TIDAK pernah jadi argumen perintah (tidak tampil di `ps`), tidak dicetak, tidak ditulis ke log.
  - Key dikirim lewat stdin SSH. Lebih aman lagi: kosongkan API_KEY di bawah -> skrip akan menanyakan
    tanpa menampilkan (getpass), atau baca dari env OMOS_LLM_API_KEY.
  - JANGAN commit skrip ini ke git setelah API_KEY terisi.

Prasyarat di laptop: python 3.8+, klien `ssh` dan `scp` (Windows 10/11: OpenSSH Client bawaan).
Prasyarat di server: python3, curl, sudo (NOPASSWD, atau isi lewat prompt).
Tidak ada paket pip yang diperlukan.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import secrets
import shlex
import subprocess
import sys
import urllib.parse

# =====================================================================================
#  ISIAN USER — EDIT BAGIAN INI
# =====================================================================================

# --- Server -------------------------------------------------------------------------
SSH_HOST = "103.58.101.240"
SSH_USER = "adminbiznet"
SSH_PORT = 22
SSH_KEY_PATH = ""            # mis. r"C:\Users\Anda\.ssh\id_ed25519" ; kosong = pakai default/agent ssh
SUDO_PASSWORD_NEEDED = False  # True bila sudo di server minta password (akan ditanya, tidak ditampilkan)

OMOS_ROOT = "/opt/omos"
APP_ENV_PATH = "/opt/omos/secrets/app.env"
KEY_FILE_PATH = "/opt/omos/secrets/llm_api_key"
CONTAINER_UID = 1000          # uid user "node" di container (sama seperti install-llm-key.sh)

# --- Agen / provider ----------------------------------------------------------------
PROVIDER = "nvidia_nim"                                   # label provider
AGENT_NAME = "omos-hse-agent"                             # nama agen (label; dicatat di app.env)
BASE_URL = "https://integrate.api.nvidia.com/v1"          # HARUS https
ALLOWED_HOSTS = "integrate.api.nvidia.com"                # pisahkan koma bila lebih dari satu

# ID model: SALIN dari kartu model di build.nvidia.com atau `curl <BASE_URL>/models`. Jangan ditebak.
MODEL_STANDARD = ""                                       # WAJIB — mis. ID GLM-5.3 Flash
MODEL_CHEAP = ""                                          # opsional (kosong = tidak ditulis)
MODEL_VISION = ""                                         # opsional (untuk agen PDF/gambar nanti)
MODEL_STANDARD_FALLBACK = ""                              # opsional

API_KEY = ""                                              # kosong = ditanya saat jalan (disarankan)

# --- Parameter lain -----------------------------------------------------------------
TIMEOUT_MS = 30000
PRICE_INPUT_PER_MTOK = "0"       # free endpoint = 0
PRICE_OUTPUT_PER_MTOK = "0"
EXTRA_BODY = ""                  # JSON string, mis. '{"chat_template_kwargs":{"thinking":false}}' ; kosong = tidak ditulis
JSON_MODE = ""                   # kosong = biarkan default server; isi "true"/"false" bila perlu
LLM_ENABLED = "true"             # "true" = server boleh memanggil LLM (fitur tetap OFF sampai Admin Utama
                                 # menyalakannya di Setup -> Asisten AI)

# --- Unggah berkas (opsional) -------------------------------------------------------
# Pasangan (path_lokal, path_server). Contoh: skrip ops terbaru ke server.
UPLOADS: list[tuple[str, str]] = [
    # ("ops/biznet/install-llm-key.sh", "/opt/omos/ops/install-llm-key.sh"),
]

# Dijalankan di server bila memakai --restart. Env baru hanya terbaca saat container start ulang.
# (Key baru TIDAK butuh restart — dibaca ulang tiap 60 detik.) Sesuaikan dengan alur rilis Anda,
# mis. rilis ulang rilis aktif lewat release-app.sh:
RESTART_COMMAND = ""             # mis. "docker restart omos-app-staging"

# =====================================================================================
#  BATAS ISIAN USER
# =====================================================================================

ENV_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")


class Abort(Exception):
    pass


def build_env_map() -> dict[str, str]:
    env = {
        "LLM_ENABLED": LLM_ENABLED,
        "LLM_PROVIDER": PROVIDER,
        "LLM_AGENT_NAME": AGENT_NAME,
        "LLM_BASE_URL": BASE_URL,
        "LLM_ALLOWED_HOSTS": ALLOWED_HOSTS,
        "LLM_API_KEY_FILE": "/run/secrets/llm_api_key",
        "LLM_MODEL_STANDARD": MODEL_STANDARD,
        "LLM_TIMEOUT_MS": str(TIMEOUT_MS),
        "LLM_PRICE_INPUT_PER_MTOK": PRICE_INPUT_PER_MTOK,
        "LLM_PRICE_OUTPUT_PER_MTOK": PRICE_OUTPUT_PER_MTOK,
    }
    optional = {
        "LLM_MODEL_CHEAP": MODEL_CHEAP,
        "LLM_MODEL_VISION": MODEL_VISION,
        "LLM_MODEL_STANDARD_FALLBACK": MODEL_STANDARD_FALLBACK,
        "LLM_EXTRA_BODY": EXTRA_BODY,
        "LLM_JSON_MODE": JSON_MODE,
    }
    env.update({k: v for k, v in optional.items() if v.strip()})
    return {k: v.strip() for k, v in env.items()}


def validate(env: dict[str, str]) -> None:
    errs = []
    u = urllib.parse.urlparse(env["LLM_BASE_URL"])
    if u.scheme != "https" or not u.hostname:
        errs.append("BASE_URL harus https://host/...")
    hosts = [h.strip().lower() for h in env["LLM_ALLOWED_HOSTS"].split(",") if h.strip()]
    if not hosts:
        errs.append("ALLOWED_HOSTS kosong")
    elif u.hostname and u.hostname.lower() not in hosts:
        errs.append(f"host {u.hostname} tidak ada di ALLOWED_HOSTS ({', '.join(hosts)}) — server akan menolak")
    if not env.get("LLM_MODEL_STANDARD"):
        errs.append("MODEL_STANDARD wajib diisi (salin ID model dari kartu model NVIDIA)")
    if env.get("LLM_EXTRA_BODY"):
        try:
            json.loads(env["LLM_EXTRA_BODY"])
        except ValueError:
            errs.append("EXTRA_BODY bukan JSON valid")
    if not re.fullmatch(r"\d+", env["LLM_TIMEOUT_MS"]):
        errs.append("TIMEOUT_MS harus angka")
    if env["LLM_ENABLED"] not in ("true", "false"):
        errs.append('LLM_ENABLED harus "true" atau "false"')
    for k, v in env.items():
        if not ENV_NAME_RE.match(k):
            errs.append(f"nama env tidak valid: {k}")
        if "\n" in v or "\r" in v:
            errs.append(f"{k} berisi baris baru")
    if errs:
        raise Abort("Isian belum benar:\n  - " + "\n  - ".join(errs))


def get_api_key() -> str:
    key = API_KEY or os.environ.get("OMOS_LLM_API_KEY", "")
    if not key:
        key = getpass.getpass("Tempel API key (tidak akan tampil): ")
    key = re.sub(r"\s+", "", key)
    if len(key) < 8:
        raise Abort("API key kosong / terlalu pendek.")
    return key


def remote_script(env: dict[str, str], key: str) -> str:
    """Skrip bash yang dijalankan di server (dikirim lewat stdin). Key hanya ada di sini."""
    delim = "KEY_" + secrets.token_hex(12)
    env_json = json.dumps(env)
    py_update = r'''
import json, os, sys, re, tempfile
path = sys.argv[1]
new = json.loads(sys.stdin.read())
lines = open(path, encoding="utf-8").read().splitlines() if os.path.exists(path) else []
seen = set()
out = []
for ln in lines:
    m = re.match(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=", ln)
    if m and m.group(1) in new:
        if m.group(1) in seen:
            continue                      # buang duplikat lama
        seen.add(m.group(1))
        out.append("%s=%s" % (m.group(1), new[m.group(1)]))
    else:
        out.append(ln)
missing = [k for k in new if k not in seen]
if missing:
    if out and out[-1].strip():
        out.append("")
    out.append("# --- Agen LLM (dikelola deploy_llm_agent.py) ---")
    out += ["%s=%s" % (k, new[k]) for k in missing]
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
with os.fdopen(fd, "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
st = os.stat(path) if os.path.exists(path) else None
if st:
    os.chmod(tmp, st.st_mode & 0o777); os.chown(tmp, st.st_uid, st.st_gid)
os.replace(tmp, path)
print("  env diperbarui: %d diganti, %d ditambah" % (len(seen), len(missing)))
'''
    return f'''set -euo pipefail
KEY_FILE={shlex.quote(KEY_FILE_PATH)}
APP_ENV={shlex.quote(APP_ENV_PATH)}
OWNER_UID={int(CONTAINER_UID)}
BASE_URL={shlex.quote(env["LLM_BASE_URL"])}
MODEL={shlex.quote(env["LLM_MODEL_STANDARD"])}

command -v python3 >/dev/null || {{ echo "python3 tidak ada di server" >&2; exit 2; }}
command -v curl >/dev/null || {{ echo "curl tidak ada di server" >&2; exit 2; }}
[ -d "$(dirname "$KEY_FILE")" ] || install -d -m 700 "$(dirname "$KEY_FILE")"

echo "[1/4] tulis API key -> $KEY_FILE (0400, uid $OWNER_UID)"
umask 077
TMP="$(mktemp "$(dirname "$KEY_FILE")/.llm_api_key.XXXXXX")"
tr -d '[:space:]' > "$TMP" <<'{delim}'
{key}
{delim}
[ -s "$TMP" ] || {{ rm -f "$TMP"; echo "key kosong" >&2; exit 3; }}
chown "$OWNER_UID" "$TMP"; chmod 400 "$TMP"; mv -f "$TMP" "$KEY_FILE"

echo "[2/4] backup & perbarui $APP_ENV"
if [ -f "$APP_ENV" ]; then
  BAK="$APP_ENV.bak.$(date +%Y%m%d-%H%M%S)"; cp -p "$APP_ENV" "$BAK"; echo "  backup: $BAK"
fi
PYUP="$(mktemp)"
cat > "$PYUP" <<'PYEOF_{delim}'
{py_update}
PYEOF_{delim}
printf '%s' {shlex.quote(env_json)} | python3 "$PYUP" "$APP_ENV"
rm -f "$PYUP"

'''
    + f'''
echo "[3/4] uji host: $BASE_URL"
curl -fsS --max-time 15 "$BASE_URL/models" -o /dev/null && echo "  host terjangkau" || echo "  PERINGATAN: host tidak terjangkau dari server"

echo "[4/4] uji 1 panggilan kecil ke model"
BODY="$(python3 -c 'import json,sys;print(json.dumps({{"model":sys.argv[1],"messages":[{{"role":"user","content":"Jawab satu kata: OK"}}],"max_tokens":5,"temperature":0}}))' "$MODEL")"
CODE="$(sed 's/^/Authorization: Bearer /' "$KEY_FILE" | curl -sS --max-time 45 -o /dev/null -w '%{{http_code}}' -H @- -H 'Content-Type: application/json' "$BASE_URL/chat/completions" -d "$BODY" || echo 000)"
echo "  HTTP $CODE  (200 = key & model OK; 401/403 = key ditolak; 404 = ID model salah; 429 = dibatasi; 000 = jaringan)"
echo "SELESAI_HTTP=$CODE"
'''


def ssh_base() -> list[str]:
    cmd = ["ssh", "-p", str(SSH_PORT), "-o", "BatchMode=no", "-o", "ServerAliveInterval=15"]
    if SSH_KEY_PATH:
        cmd += ["-i", SSH_KEY_PATH]
    cmd.append(f"{SSH_USER}@{SSH_HOST}")
    return cmd


def run_remote(script: str, sudo_pw: str | None, timeout: int = 180) -> tuple[int, str]:
    if sudo_pw is not None:
        remote = "sudo -S -p '' bash -s"
        stdin = sudo_pw + "\n" + script
    else:
        remote = "sudo -n bash -s"
        stdin = script
    p = subprocess.run(ssh_base() + [remote], input=stdin, text=True,
                       capture_output=True, timeout=timeout)
    return p.returncode, (p.stdout or "") + (("\n" + p.stderr) if p.stderr.strip() else "")


def do_uploads() -> None:
    for local, remote in UPLOADS:
        if not os.path.isfile(local):
            raise Abort(f"berkas lokal tidak ada: {local}")
        print(f"  scp {local} -> {remote}")
        tmp_remote = f"/tmp/.omos_up_{secrets.token_hex(4)}"
        cmd = ["scp", "-P", str(SSH_PORT)] + (["-i", SSH_KEY_PATH] if SSH_KEY_PATH else [])
        cmd += [local, f"{SSH_USER}@{SSH_HOST}:{tmp_remote}"]
        subprocess.run(cmd, check=True)
        mv = f"sudo -n install -D -m 0755 {shlex.quote(tmp_remote)} {shlex.quote(remote)} && rm -f {shlex.quote(tmp_remote)}"
        subprocess.run(ssh_base() + [mv], check=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="Pasang konfigurasi agen LLM OMOS ke server Biznet.")
    ap.add_argument("--dry-run", action="store_true", help="tampilkan rencana & skrip server (key disamarkan), tanpa koneksi")
    ap.add_argument("--restart", action="store_true", help="jalankan RESTART_COMMAND setelah sukses")
    ap.add_argument("--skip-upload", action="store_true", help="lewati UPLOADS")
    args = ap.parse_args()

    try:
        env = build_env_map()
        validate(env)

        print("== Rencana ==")
        print(f"  server : {SSH_USER}@{SSH_HOST}:{SSH_PORT}")
        print(f"  agen   : {AGENT_NAME}  (provider {PROVIDER})")
        for k, v in env.items():
            print(f"  {k}={v}")
        print(f"  key    : -> {KEY_FILE_PATH} (0400, uid {CONTAINER_UID})  [nilai tidak ditampilkan]")

        if args.dry_run:
            print("\n== Skrip yang akan dikirim ke server (key disamarkan) ==\n")
            print(remote_script(env, "********"))
            return 0

        key = get_api_key()
        sudo_pw = getpass.getpass("Password sudo server (tidak akan tampil): ") if SUDO_PASSWORD_NEEDED else None

        if UPLOADS and not args.skip_upload:
            print("\n== Unggah berkas ==")
            do_uploads()

        print("\n== Eksekusi di server ==")
        rc, out = run_remote(remote_script(env, key), sudo_pw)
        key = ""  # lepaskan referensi
        out = re.sub(r"(Bearer\s+)\S+", r"\1***", out)
        print(out)
        if rc != 0:
            print(f"GAGAL (exit {rc}). Periksa pesan di atas. Backup app.env tetap ada bila langkah 2 sempat jalan.")
            return rc

        m = re.search(r"SELESAI_HTTP=(\d+)", out)
        code = m.group(1) if m else "?"
        if code != "200":
            print(f"\nKonfigurasi terpasang, TAPI uji model HTTP {code} (bukan 200). Perbaiki key/ID model lalu jalankan ulang.")

        if args.restart:
            if not RESTART_COMMAND.strip():
                print("RESTART_COMMAND kosong — lewati restart.")
            else:
                print("\n== Restart ==")
                cmd = f"sudo -n bash -lc {shlex.quote(RESTART_COMMAND)}"
                r = subprocess.run(ssh_base() + [cmd], text=True, capture_output=True, timeout=300)
                print(r.stdout + r.stderr)
                if r.returncode != 0:
                    return r.returncode
        else:
            print("\nCatatan: perubahan app.env baru terbaca setelah container start ulang "
                  "(jalankan lagi dengan --restart atau rilis ulang). Pergantian KEY saja tidak perlu restart.")

        print("\nLangkah berikut: login sebagai Admin Utama -> Setup -> Asisten AI -> nyalakan fitur bertahap "
              "(OFF -> SHADOW -> ON). Lihat docs/DEPLOY_AI_HSE_099.md.")
        return 0
    except Abort as e:
        print(str(e), file=sys.stderr)
        return 1
    except subprocess.TimeoutExpired:
        print("Timeout menunggu server.", file=sys.stderr)
        return 1
    except FileNotFoundError as e:
        print(f"Perintah tidak ditemukan ({e.filename}). Pasang OpenSSH Client.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
