#!/usr/bin/env bash
# (Re)create the loopback SMTP forwarder that shares the Auth container's network namespace.
# GoTrue only sends SMTP AUTH credentials over loopback or TLS; this relays 127.0.0.1:2525 inside the
# Auth container to the host-side dev sink (scripts/mail-sink.mjs). Persistent, one process per
# connection (busybox `nc -lk -e`). Must be re-run whenever the Auth container is recreated.
set -euo pipefail
docker rm -f afit_mail_fwd >/dev/null 2>&1 || true
docker run -d --name afit_mail_fwd --network container:supabase_auth_nepamzy --entrypoint sh \
  supabase/gotrue:v2.197.0 -c 'nc -lk -p 2525 -e nc host.docker.internal 54325' >/dev/null
