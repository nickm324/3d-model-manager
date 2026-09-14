#!/bin/sh
set -eu

IMAGE_NAME="3d-model-manager:local"
TEST_CONTAINER="3d-model-manager-build-test"
DATA_HOST_PATH="${DATA_HOST_PATH:-/srv/appdata/3d-model-manager}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

mkdir -p "$DATA_HOST_PATH"
chown "$PUID:$PGID" "$DATA_HOST_PATH"

docker build --pull -t "$IMAGE_NAME" .
docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
trap 'docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$TEST_CONTAINER" \
  --user "$PUID:$PGID" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  -v "$DATA_HOST_PATH:/data" \
  "$IMAGE_NAME" >/dev/null

attempt=0
until docker exec "$TEST_CONTAINER" node -e "fetch('http://127.0.0.1:3210/api/health').then(async r=>{const b=await r.json();if(!r.ok||!b.ok)process.exit(1)}).catch(()=>process.exit(1))"; do
  attempt=$((attempt + 1))
  if [ "$(docker inspect -f '{{.State.Running}}' "$TEST_CONTAINER" 2>/dev/null || echo false)" != "true" ]; then
    docker logs "$TEST_CONTAINER" 2>&1 || true
    echo "Container stopped before its health check passed."
    exit 1
  fi
  if [ "$attempt" -ge 20 ]; then
    docker logs "$TEST_CONTAINER"
    echo "Container health test failed."
    exit 1
  fi
  sleep 1
done

echo "Image $IMAGE_NAME built successfully and passed its container health test."
echo "You can now deploy compose.portainer.yaml in Portainer."
