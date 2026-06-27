#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

SSH_HOST="bmad"
REMOTE_DIR="/home/ubuntu/camel"
IMAGE_NAME="camel-server"
IMAGE_FILE="/tmp/camel-server.tar.gz"

echo "=== Building client ==="
cd "$PROJECT_ROOT"
npm run build --workspace=client

echo "=== Building server Docker image ==="
docker build --platform linux/amd64 -t ${IMAGE_NAME}:latest -f "$PROJECT_ROOT/Dockerfile" "$PROJECT_ROOT"

echo "=== Exporting Docker image ==="
docker save ${IMAGE_NAME}:latest | gzip > ${IMAGE_FILE}
echo "Image size: $(du -sh ${IMAGE_FILE} | cut -f1)"

echo "=== Uploading to server ==="
scp -r "$PROJECT_ROOT/client/dist/." ${SSH_HOST}:/var/www/camel/

scp ${IMAGE_FILE} ${SSH_HOST}:${REMOTE_DIR}/camel-server.tar.gz

scp "$SCRIPT_DIR/docker-compose.prod.yml" ${SSH_HOST}:${REMOTE_DIR}/docker-compose.prod.yml

echo "=== Loading image on server ==="
ssh ${SSH_HOST} "
  docker load < ${REMOTE_DIR}/camel-server.tar.gz
  rm ${REMOTE_DIR}/camel-server.tar.gz
"

echo "=== Restarting services ==="
ssh ${SSH_HOST} "
  cd ${REMOTE_DIR}
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d --remove-orphans
"

echo "=== Cleanup local image file ==="
rm ${IMAGE_FILE}

echo "=== Done ==="
ssh ${SSH_HOST} "docker compose -f ${REMOTE_DIR}/docker-compose.prod.yml ps"
