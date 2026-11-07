#!/usr/bin/env bash
# Installed as ~/.local/bin/snoojote-auto-deploy and run by the VPS timer.
set -Eeuo pipefail
export PATH="$HOME/.bun/bin:$PATH"
repo=/home/ubuntu/new-snoojote
cd "$repo"
exec 8>.git/snoojote-auto-deploy.lock
flock -n 8 || exit 0
git fetch origin main
sha=$(git rev-parse origin/main)
if [[ "$sha" == "$(git rev-parse HEAD)" ]]; then exit 0; fi
if [[ -f .git/snoojote-failed-deploy && "$sha" == "$(cat .git/snoojote-failed-deploy)" ]]; then
    echo "Commit $sha previously failed. Push a fix or remove .git/snoojote-failed-deploy to retry."
    exit 1
fi
candidate=$(mktemp -d)
trap 'rm -rf "$candidate"' EXIT
trap 'echo "$sha" > "$repo/.git/snoojote-failed-deploy"; echo "Checks or deployment failed for $sha"' ERR
git archive "$sha" | tar -x -C "$candidate"
cd "$candidate"
echo "Checking candidate $sha in isolation"
bun install --frozen-lockfile
for script in ops/*.sh; do bash -n "$script"; done
bash ops/deploy.test.sh
bun run check
bun run audit
cd "$repo"
SSH_ORIGINAL_COMMAND="$sha" "$HOME/.local/bin/snoojote-deploy"
rm -f .git/snoojote-failed-deploy
echo "Automatic deployment completed for $sha"
