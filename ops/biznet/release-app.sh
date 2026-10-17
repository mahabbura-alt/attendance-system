#!/usr/bin/env sh
set -eu

RELEASE_DIR="${1:?release directory is required}"
IMAGE_TAG="${2:?image tag is required}"
RELEASE_NAME="${3:?release name is required}"
ENV_FILE="${4:-/opt/omos/secrets/app.env}"
CURRENT_LINK="/opt/omos/current"
OLD_RELEASE="$(readlink -f "$CURRENT_LINK")"
CANDIDATE="omos-app-candidate-$RELEASE_NAME"
# Agen LLM: file API key dipasang read-only bila ada (lihat ops/biznet/install-llm-key.sh).
LLM_KEY_FILE="/opt/omos/secrets/llm_api_key"
LLM_MOUNT=""
if [ -f "$LLM_KEY_FILE" ]; then
  LLM_MOUNT="-v $LLM_KEY_FILE:/run/secrets/llm_api_key:ro"
fi
PREVIOUS="omos-app-prev-$RELEASE_NAME"

test -d "$RELEASE_DIR"
test -r "$ENV_FILE"
test -f "$RELEASE_DIR/ops/biznet/Dockerfile.app"

echo "[release] build $IMAGE_TAG"
docker build -f "$RELEASE_DIR/ops/biznet/Dockerfile.app" -t "$IMAGE_TAG" "$RELEASE_DIR"

cleanup_candidate() {
  docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
}
trap cleanup_candidate EXIT INT TERM

echo "[release] candidate"
docker run -d --name "$CANDIDATE" --restart no \
  --network biznet_default --env-file "$ENV_FILE" \
  -p 127.0.0.1:3001:3000 --read-only --tmpfs /tmp:size=64m,mode=1777 \
  --security-opt no-new-privileges:true --memory 768m --cpus 1.5 \
  -v /opt/omos/storage:/data/storage \
  -v /opt/omos/storage-manifests:/data/storage-manifests \
  $LLM_MOUNT \
  "$IMAGE_TAG" >/dev/null
docker network connect biznet_omos_data "$CANDIDATE"

attempt=0
until curl -fsS http://127.0.0.1:3001/health >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs --tail 100 "$CANDIDATE" >&2 || true
    exit 1
  fi
  sleep 1
done

auth_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/admin/cuti/dashboard)"
test -f "$RELEASE_DIR/admin-dashboard/cuti.js"
test -f "$RELEASE_DIR/admin-dashboard/cuti.css"
test -f "$RELEASE_DIR/mobile-web/index.html"
test -f "$RELEASE_DIR/mobile-web/karyawan.js"
echo "[release] candidate codes health=200 auth=$auth_code static=release-present"
test "$auth_code" = "401"
echo "[release] candidate healthy"

cleanup_candidate
trap - EXIT INT TERM

echo "[release] switch"
docker stop omos-app >/dev/null
docker rename omos-app "$PREVIOUS"
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

rollback() {
  echo "[release] rollback" >&2
  docker rm -f omos-app >/dev/null 2>&1 || true
  docker rename "$PREVIOUS" omos-app >/dev/null 2>&1 || true
  docker start omos-app >/dev/null 2>&1 || true
  ln -sfn "$OLD_RELEASE" "$CURRENT_LINK"
}
trap rollback EXIT INT TERM

docker run -d --name omos-app --restart unless-stopped \
  --network biznet_default --env-file "$ENV_FILE" \
  -p 127.0.0.1:3000:3000 --read-only --tmpfs /tmp:size=64m,mode=1777 \
  --security-opt no-new-privileges:true --memory 768m --cpus 1.5 \
  -v /opt/omos/storage:/data/storage \
  -v /opt/omos/storage-manifests:/data/storage-manifests \
  $LLM_MOUNT \
  "$IMAGE_TAG" >/dev/null
docker network connect biznet_omos_data omos-app

attempt=0
until curl -fsS http://127.0.0.1:3000/health >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs --tail 100 omos-app >&2 || true
    exit 1
  fi
  sleep 1
done

test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/admin/cuti/dashboard)" = "401"
test "$(curl -ksS -o /dev/null -w '%{http_code}' 'https://127.0.0.1/cuti.js?v=2')" = "200"
test "$(curl -ksS -o /dev/null -w '%{http_code}' 'https://127.0.0.1/cuti.css?v=2')" = "200"
test "$(curl -ksS -o /dev/null -w '%{http_code}' 'https://127.0.0.1/karyawan.html')" = "200"
test "$(curl -ksS -o /dev/null -w '%{http_code}' 'https://127.0.0.1/mobile-web/karyawan.js')" = "200"
trap - EXIT INT TERM
echo "[release] live=$RELEASE_DIR previous=$PREVIOUS"
