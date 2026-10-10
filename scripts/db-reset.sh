#!/usr/bin/env bash
# Reset the LOCAL database (migrations + seed) and restore the mail forwarder.
set -euo pipefail
cd "$(dirname "$0")/.."
export SUPABASE_INTERNAL_IMAGE_REGISTRY="${SUPABASE_INTERNAL_IMAGE_REGISTRY:-docker.io}"
./node_modules/.bin/supabase db reset
sleep 5
bash scripts/mail-forwarder.sh
