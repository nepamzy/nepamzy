#!/usr/bin/env bash
# Start the LOCAL Supabase stack (Docker) plus the local mail sink. Free, local only; never
# touches a remote project or sends real email.
#
# Notes (environment-specific workarounds, see docs/review-log.md "Batch 1 pre-work"):
#  * The default public ECR image registry rate-limits anonymous pulls in some environments
#    ("Data limit exceeded"); the same images are published on Docker Hub, hence the override.
#  * The CLI's own mail catcher image is not available from Docker Hub, so scripts/mail-sink.mjs
#    (host process) receives Auth emails. Go refuses SMTP AUTH over a non-loopback unencrypted
#    connection, so a tiny forwarder container shares the Auth container's network namespace and
#    relays 127.0.0.1:2525 -> host sink :54325.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon not running; trying to start dockerd locally..."
  (nohup dockerd >/tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  docker info >/dev/null 2>&1 || { echo "BLOCKED: Docker daemon unavailable"; exit 1; }
fi
export SUPABASE_INTERNAL_IMAGE_REGISTRY="${SUPABASE_INTERNAL_IMAGE_REGISTRY:-docker.io}"
SB="./node_modules/.bin/supabase"
EXCLUDE="studio,imgproxy,vector,logflare,edge-runtime,realtime,storage-api,postgres-meta,supavisor,mailpit"

if ! pgrep -f "^node scripts/mail-sink" >/dev/null; then
  (nohup node scripts/mail-sink.mjs >/tmp/mail-sink.log 2>&1 &)
fi
${SB} start -x "${EXCLUDE}"
bash scripts/mail-forwarder.sh
echo "Local stack ready. Print keys with: ./node_modules/.bin/supabase status -o env"
