#!/usr/bin/env bash
# Pasang / ganti API key LLM di server TANPA menampilkan key dan tanpa masuk history shell.
# Pemakaian (di server): sudo bash ops/biznet/install-llm-key.sh [uid_container=1000]
#   - Menulis /opt/omos/secrets/llm_api_key (mode 0400, pemilik uid user "node" di container).
#   - Menguji key ke NVIDIA NIM dengan header dari stdin (key tidak muncul di daftar proses).
# Key dibaca ulang oleh aplikasi tiap 60 detik: ganti key tidak perlu restart container.
# Container harus dijalankan dengan: -v /opt/omos/secrets/llm_api_key:/run/secrets/llm_api_key:ro
set -euo pipefail

KEY_FILE="/opt/omos/secrets/llm_api_key"
OWNER_UID="${1:-1000}"
BASE_URL="${LLM_BASE_URL:-https://integrate.api.nvidia.com/v1}"

if [ "$(id -u)" -ne 0 ]; then echo "Jalankan dengan sudo." >&2; exit 1; fi
[ -d /opt/omos/secrets ] || install -d -m 700 /opt/omos/secrets  # jangan ubah izin folder yang sudah ada

read -rsp "Tempel API key (tidak akan tampil): " KEY; echo
KEY="$(printf %s "$KEY" | tr -d '[:space:]')"
if [ -z "$KEY" ]; then echo "Key kosong, dibatalkan." >&2; exit 1; fi

umask 077
TMP="$(mktemp /opt/omos/secrets/.llm_api_key.XXXXXX)"
printf %s "$KEY" > "$TMP"
chown "$OWNER_UID" "$TMP"
chmod 400 "$TMP"
mv -f "$TMP" "$KEY_FILE"
unset KEY
echo "[llm-key] tersimpan di $KEY_FILE (0400, uid $OWNER_UID)"

echo "[llm-key] uji: daftar model (tanpa key)"
curl -fsS "$BASE_URL/models" -o /dev/null && echo "  host terjangkau"

if [ -n "${LLM_MODEL_STANDARD:-}" ]; then
  echo "[llm-key] uji: 1 panggilan kecil ke $LLM_MODEL_STANDARD"
  BODY="$(printf '{"model":"%s","messages":[{"role":"user","content":"Jawab satu kata: OK"}],"max_tokens":5,"temperature":0}' "$LLM_MODEL_STANDARD")"
  CODE="$(sed 's/^/Authorization: Bearer /' "$KEY_FILE" | curl -sS -o /dev/null -w '%{http_code}' -H @- \
    -H 'Content-Type: application/json' "$BASE_URL/chat/completions" -d "$BODY")"
  echo "  HTTP $CODE (200 = key & model OK; 401/403 = key ditolak; 404 = ID model salah; 429 = dibatasi)"
else
  echo "[llm-key] lewati uji panggilan: set LLM_MODEL_STANDARD=<id model> saat menjalankan skrip untuk menguji."
fi
