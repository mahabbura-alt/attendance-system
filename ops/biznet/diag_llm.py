#!/usr/bin/env python3
"""Diagnosa kenapa LLM tidak merespons dari server OMOS (Biznet).

Dijalankan DARI LAPTOP (memakai isian SSH di deploy_llm_agent.py), mengeksekusi uji di SERVER:
  1. isi app.env bagian LLM_* (tanpa key) + info berkas key (hanya ukuran/izin)
  2. waktu koneksi TCP/TLS ke penyedia
  3. GET /models (tanpa inferensi)
  4. chat tanpa stream, beberapa varian (thinking aktif / dimatikan)
  5. chat stream (waktu sampai potongan pertama)
Key dibaca di server dan TIDAK PERNAH dicetak.

Pakai:  python diag_llm.py --list                      (daftar model akun)
        python diag_llm.py --models a/b,c/d          (bandingkan kecepatan model)
        python diag_llm.py            (butuh deploy_llm_agent.py di folder yang sama, SSH sudah terisi)
"""
import secrets
import subprocess
import sys

import deploy_llm_agent as d

REMOTE = r'''
import json, os, re, socket, ssl, sys, time, urllib.request, urllib.error
APP_ENV = %(app_env)r
KEY_FILE = %(key_file)r
CANDIDATES = %(cands)r

def p(*a): print(*a, flush=True)

env = {}
try:
    for line in open(APP_ENV, encoding="utf-8"):
        m = re.match(r"^\s*(LLM_[A-Z0-9_]+)=(.*)$", line.rstrip("\n"))
        if m: env[m.group(1)] = m.group(2).strip().strip("'\"")
except Exception as e:
    p("! tidak bisa baca app.env:", type(e).__name__)
p("== 1. Konfigurasi di server ==")
for k in sorted(env):
    if "KEY" in k and k != "LLM_API_KEY_FILE": v = "[disembunyikan]"
    else: v = env[k]
    p("  %%s=%%s" %% (k, v))
try:
    st = os.stat(KEY_FILE); p("  key file: %%d byte, mode %%o, uid %%d" %% (st.st_size, st.st_mode & 0o777, st.st_uid))
    key = open(KEY_FILE).read().strip()
except Exception as e:
    p("! key tidak terbaca:", type(e).__name__); sys.exit(1)
base = env.get("LLM_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/")
model = env.get("LLM_MODEL_STANDARD", "")
host = re.sub(r"^https?://", "", base).split("/")[0]
p("  model:", model, "| host:", host)
p("  catatan: LLM_ENABLED=%%s, LLM_TIMEOUT_MS=%%s, LLM_JSON_MODE=%%s, LLM_EXTRA_BODY=%%s" %% (env.get("LLM_ENABLED"), env.get("LLM_TIMEOUT_MS"), env.get("LLM_JSON_MODE"), env.get("LLM_EXTRA_BODY")))

if CANDIDATES:
    ids = []
    try:
        rq = urllib.request.Request(base + "/models", headers={"Authorization": "Bearer " + key})
        ids = [m["id"] for m in json.loads(urllib.request.urlopen(rq, timeout=30).read())["data"]]
    except Exception as e:
        p("! gagal ambil daftar model:", e)
    if CANDIDATES == ["list"]:
        p("== Daftar model tersedia =="); [p("  " + i) for i in sorted(ids)]; sys.exit(0)
    p("== Uji kandidat model (JSON seperti planner Tanya OMOS) ==")
    prompt = [{"role": "system", "content": "Kamu perencana. Balas HANYA JSON sesuai skema."}, {"role": "user", "content": 'Pertanyaan: "Berapa hazard bulan ini?" Tool tersedia: hazard, insiden, kpi_keselamatan. Balas JSON: {"tools":[{"nama":"...","args":{}}],"tidak_bisa_dijawab":""}'}]
    for mid in CANDIDATES:
        if ids and mid not in ids:
            p("  [%%s] TIDAK ADA di daftar model akun ini" %% mid); continue
        t0 = time.time()
        try:
            rq = urllib.request.Request(base + "/chat/completions", data=json.dumps({"model": mid, "messages": prompt, "max_tokens": 300, "temperature": 0, "stream": False}).encode(), headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
            j = json.loads(urllib.request.urlopen(rq, timeout=100).read()); m = j["choices"][0]
            p("  [%%s] %%.1f dtk, finish=%%s, reasoning_tokens=%%s, isi=%%r" %% (mid, time.time()-t0, m.get("finish_reason"), (j.get("usage", {}).get("completion_tokens_details") or {}).get("reasoning_tokens"), (m["message"].get("content") or "")[:120]))
        except Exception as e:
            p("  [%%s] GAGAL setelah %%.1f dtk: %%s %%s" %% (mid, time.time()-t0, type(e).__name__, e))
    sys.exit(0)

p("\n== 2. Koneksi jaringan ==")
t = time.time()
try:
    ip = socket.gethostbyname(host); p("  DNS %%s -> %%s (%%.2f dtk)" %% (host, ip, time.time()-t))
    t = time.time(); s = socket.create_connection((host, 443), timeout=15); p("  TCP 443 ok (%%.2f dtk)" %% (time.time()-t))
    t = time.time(); c = ssl.create_default_context().wrap_socket(s, server_hostname=host); p("  TLS ok (%%.2f dtk)" %% (time.time()-t)); c.close()
except Exception as e:
    p("  ! GAGAL:", type(e).__name__, e)

def call(label, path, body=None, timeout=100, stream=False):
    url = base + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET", headers={"Authorization": "Bearer " + key, "Content-Type": "application/json", "Accept": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if stream:
                first = None; n = 0; text = ""
                for raw in r:
                    if first is None: first = time.time()-t0
                    n += 1
                    if raw.startswith(b"data:") and b"[DONE]" not in raw:
                        try:
                            dl = json.loads(raw[5:])["choices"][0].get("delta", {})
                            text += (dl.get("content") or "")
                        except Exception: pass
                p("  [%%s] HTTP %%d, potongan pertama %%.1f dtk, total %%.1f dtk, %%d baris, isi: %%r" %% (label, r.status, first or -1, time.time()-t0, n, text[:80]))
                return
            raw = r.read(); dt = time.time()-t0
            if body is None:
                try: n = len(json.loads(raw).get("data", []))
                except Exception: n = "?"
                p("  [%%s] HTTP %%d, %%.1f dtk, %%s model terdaftar" %% (label, r.status, dt, n)); return
            j = json.loads(raw); m = (j.get("choices") or [{}])[0]; msg = m.get("message", {})
            c = msg.get("content"); rc = msg.get("reasoning_content") or msg.get("reasoning")
            p("  [%%s] HTTP %%d, %%.1f dtk, finish=%%s, isi=%%r, panjang_reasoning=%%s, usage=%%s" %% (label, r.status, dt, m.get("finish_reason"), (c or "")[:80], len(rc) if rc else 0, j.get("usage")))
    except urllib.error.HTTPError as e:
        p("  [%%s] HTTP %%d setelah %%.1f dtk: %%s" %% (label, e.code, time.time()-t0, e.read()[:200]))
    except Exception as e:
        p("  [%%s] GAGAL setelah %%.1f dtk: %%s %%s" %% (label, time.time()-t0, type(e).__name__, e))

p("\n== 3. Daftar model (tanpa inferensi) ==")
call("GET /models", "/models", timeout=30)

msgs = [{"role": "user", "content": "Jawab satu kata: OK"}]
msgs_json = [{"role": "user", "content": 'Balas HANYA JSON: {"tools":[],"tidak_bisa_dijawab":"contoh"}'}]
p("\n== 4. Chat tanpa stream ==")
call("A. bawaan max_tokens=20", "/chat/completions", {"model": model, "messages": msgs, "max_tokens": 20, "temperature": 0, "stream": False})
call("B. bawaan max_tokens=500 JSON", "/chat/completions", {"model": model, "messages": msgs_json, "max_tokens": 500, "temperature": 0, "stream": False})
call("C. thinking=false", "/chat/completions", {"model": model, "messages": msgs_json, "max_tokens": 500, "temperature": 0, "stream": False, "chat_template_kwargs": {"thinking": False}})
call("D. enable_thinking=false", "/chat/completions", {"model": model, "messages": msgs_json, "max_tokens": 500, "temperature": 0, "stream": False, "chat_template_kwargs": {"enable_thinking": False}})
p("\n== 5. Chat stream ==")
call("E. stream", "/chat/completions", {"model": model, "messages": msgs_json, "max_tokens": 500, "temperature": 0, "stream": True}, stream=True)
p("\nSelesai.")
'''

def main():
    cands = []
    if "--list" in sys.argv:
        cands = ["list"]
    elif "--models" in sys.argv:
        cands = [m.strip() for m in sys.argv[sys.argv.index("--models") + 1].split(",") if m.strip()]
    script = REMOTE % {"app_env": d.APP_ENV_PATH, "key_file": d.KEY_FILE_PATH, "cands": cands}
    remote_file = f"/tmp/.omos_diag_{secrets.token_hex(6)}.py"
    p1 = subprocess.run(d.ssh_base() + [f"umask 077; cat > {remote_file}"], input=script.replace("\r\n", "\n").encode(), capture_output=True, timeout=60)
    if p1.returncode != 0:
        print(p1.stderr.decode("utf-8", "replace")); return 1
    sudo = "sudo -n"
    if d.SUDO_PASSWORD_NEEDED:
        import getpass
        pw = getpass.getpass("Password sudo (tidak tampil): ")
        proc = subprocess.Popen(d.ssh_base() + [f"sudo -S -p '' python3 {remote_file}; rm -f {remote_file}"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        proc.stdin.write((pw + "\n").encode()); proc.stdin.close()
    else:
        proc = subprocess.Popen(d.ssh_base() + [f"{sudo} python3 {remote_file}; rm -f {remote_file}"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for raw in proc.stdout:
        print(raw.decode("utf-8", "replace").replace("\r", "").rstrip("\n"), flush=True)
    return proc.wait()

if __name__ == "__main__":
    sys.exit(main())
