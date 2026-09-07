#!/usr/bin/env bash
#
# Runs ON the EC2 instance, sent there by `aws ssm send-command` from the deploy
# workflow. It used to live inline in an `appleboy/ssh-action` `script:` block;
# it is a file now so it can be read, diffed and shellchecked like code, and so
# staging and production cannot drift apart by being edited separately.
#
# The workflow prepends a block of `KEY=value` assignments before this body —
# see "Deploy via SSM" — so everything in REQUIRED below arrives as a plain
# environment variable. Nothing secret is among them: SSM retains command text
# in run history for 30 days, so the actual secrets travel via Parameter Store
# and are fetched below instead.
#
# SSM runs commands as root, unlike the ec2-user SSH login this replaced. The
# env file is therefore written by root and chowned back, so anyone debugging by
# hand still owns it.

set -e

REQUIRED="ECR_REGISTRY ECR_REPOSITORY IMAGE_TAG AWS_REGION SSM_ENV_PARAMETER
ENV_FILE_PATH CONTAINER_NAME WORKER_NAME DOCKER_NETWORK APP_PORT HOST_PORT
WORKER_PORT WORKER_HOST_PORT"
for var in $REQUIRED; do
  if [ -z "$(eval "printf '%s' \"\${$var:-}\"")" ]; then
    echo "deploy-remote.sh: $var is not set — the workflow did not pass it."
    exit 1
  fi
done

IMAGE="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"
ENV_FILE="$ENV_FILE_PATH"

# The env file arrives from Parameter Store as a SecureString.
#
# It does NOT travel inside the SSM command, and must not be changed to. This
# file carries DATABASE_URL, ACCESS_TOKEN_SECRET, PAYMONGO_SECRET_KEY and the
# mail credentials; SSM retains command text in Run Command history for 30 days,
# readable by anyone holding ssm:ListCommands. Base64 would not help — it is
# encoding, not encryption. (The sibling gc3-client-web workflow does inline its
# env, which is safe only because every value there is NEXT_PUBLIC_* and already
# public. That pattern does not transfer here.)
#
# This is the only point at which the plaintext exists on the box, so the umask
# goes first — creating it 0600 rather than world-readable and fixing it after.
umask 077
mkdir -p "$(dirname "$ENV_FILE")"
aws ssm get-parameter \
  --name "$SSM_ENV_PARAMETER" \
  --with-decryption \
  --region "$AWS_REGION" \
  --query Parameter.Value \
  --output text >"$ENV_FILE"
chmod 600 "$ENV_FILE"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker pull "$IMAGE"

docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1 ||
  docker network create "$DOCKER_NETWORK"

# Run migrations before swapping the container.
# --entrypoint overrides the image CMD so only the migration runs (not the app).
docker run --rm \
  --entrypoint npx \
  --network "$DOCKER_NETWORK" \
  --env-file "$ENV_FILE" \
  "$IMAGE" \
  prisma migrate deploy

docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true
docker run -d --name "$CONTAINER_NAME" --restart unless-stopped \
  --network "$DOCKER_NETWORK" \
  --env-file "$ENV_FILE" \
  -p "${HOST_PORT}:${APP_PORT}" \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  "$IMAGE"

docker stop "$WORKER_NAME" 2>/dev/null || true
docker rm "$WORKER_NAME" 2>/dev/null || true
docker run -d --name "$WORKER_NAME" --restart unless-stopped \
  --network "$DOCKER_NETWORK" \
  --env-file "$ENV_FILE" \
  -p "127.0.0.1:${WORKER_HOST_PORT}:${WORKER_PORT}" \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  "$IMAGE" \
  npm run worker

# Health check loop for API container
echo "Verifying API container health..."
HEALTH_CHECK_PASSED=false
for i in $(seq 1 10); do
  if curl -sf "http://127.0.0.1:${HOST_PORT}/api/health/live" >/dev/null 2>&1; then
    echo "Health check passed!"
    HEALTH_CHECK_PASSED=true
    break
  fi
  echo "Waiting for API to become ready... (attempt $i/10)"
  sleep 3
done

if [ "$HEALTH_CHECK_PASSED" = false ]; then
  echo "Health check failed after 30 seconds. Displaying container logs:"
  docker logs "$CONTAINER_NAME" --tail 50
  exit 1
fi

# A loopback liveness probe sends no Origin header, which is the one
# caller shape the CORS allowlist waves through unconditionally — so it
# passes just as happily when no browser can reach the API. That is how
# F94 shipped green for a week. Assert a browser-shaped preflight too.
# The origin comes from CORS_ORIGIN itself: a smoke test that can
# disagree with the value it is checking is worth nothing.
# Prefer the web app URL: it is the origin the site is actually served
# from, and it is now part of the allowlist by construction, so this
# check follows the fix rather than the secret that broke.
SMOKE_ORIGIN="${MAPANYTIME_WEB_APP_URL:-${CORS_ORIGIN%%,*}}"
SMOKE_ORIGIN="${SMOKE_ORIGIN%/}"
if [ -n "$SMOKE_ORIGIN" ]; then
  echo "Verifying the CORS allowlist accepts $SMOKE_ORIGIN..."
  PREFLIGHT=$(curl -s -o /dev/null -w "%{http_code}" \
    -X OPTIONS "http://127.0.0.1:${HOST_PORT}/api/v1/auth/login" \
    -H "Origin: $SMOKE_ORIGIN" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type")
  if [ "$PREFLIGHT" != "204" ]; then
    echo "CORS preflight for $SMOKE_ORIGIN returned $PREFLIGHT, expected 204."
    echo "The API is running, but no browser served from that origin can call it."
    echo "CORS_ORIGIN is wrong for this environment. The allowlist it parsed:"
    docker logs "$CONTAINER_NAME" 2>&1 | grep -i "CORS allowlist" | tail -1
    exit 1
  fi
  echo "CORS preflight passed."
fi

docker image prune -f
