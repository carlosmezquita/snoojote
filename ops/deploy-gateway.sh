#!/usr/bin/env bash
# Installed outside the checkout; used as the deployment key's forced SSH command.
set -Eeuo pipefail
export PATH="$HOME/.bun/bin:$PATH"
cd /home/ubuntu/new-snoojote
exec 9>.git/snoojote-deploy.lock
flock -w 600 9
sha=${SSH_ORIGINAL_COMMAND:-}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a commit SHA'; exit 1; }
git fetch origin main
# Ignore superseded workflow runs instead of deploying an older commit.
if [[ "$sha" != "$(git rev-parse origin/main)" ]]; then
    echo 'Skipped: main has moved since this deployment was queued.'
    exit 0
fi
script=$(mktemp)
trap 'rm -f "$script"' EXIT
git show "$sha:ops/deploy.sh" > "$script"
bash "$script" "$sha"
