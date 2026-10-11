#!/usr/bin/env bash
# Writes .env.local for the LOCAL stack from `supabase status -o env` (used by CI and handy for new checkouts).
# Contains LOCAL development values only. Refuses to overwrite an existing file.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -e .env.local ] && { echo ".env.local already exists; not touching it"; exit 0; }
eval "$(./node_modules/.bin/supabase status -o env | grep -E '^(API_URL|PUBLISHABLE_KEY|SERVICE_ROLE_KEY|DB_URL)=')"
cat > .env.local <<EOF
SITE_URL=http://127.0.0.1:3000
SUPABASE_URL=${API_URL}
SUPABASE_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
DATABASE_URL=${DB_URL}
MAIL_SINK_URL=http://127.0.0.1:54326
APP_ENV=local
PAYSTACK_SECRET_KEY=sk_test_local_fake_key_for_dev
PAYSTACK_BASE_URL=http://127.0.0.1:3002
JOBS_SECRET=local-jobs-secret-for-tests-only-0000
EOF
echo "wrote .env.local (local values)"
