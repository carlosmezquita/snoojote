#!/usr/bin/env bash
# Invoked by deploy-gateway.sh, with its server-side lock held.
set -Eeuo pipefail
umask 077
export PATH="$HOME/.bun/bin:$PATH"
cd /opt/snoojote
sha=${1:?Expected a commit SHA}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]]
previous=$(git rev-parse HEAD)
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || {
    echo 'Tracked VPS files have local changes; refusing to overwrite them.'
    exit 1
}
git merge-base --is-ancestor "$previous" "$sha"
[[ -f .env && -f config/bot.config.json && -f data/database.sqlite ]]
command -v bun >/dev/null
command -v sqlite3 >/dev/null
sudo -n systemctl is-active --quiet snoojote

# This installation predates migration journaling. Never blindly replay migrations
# or force a schema push over production data. See docs/deployment.md.
schema_ref=$previous
if [[ -f .git/snoojote-schema-ref ]]; then
    schema_ref=$(cat .git/snoojote-schema-ref)
fi
if ! git diff --quiet "$schema_ref" "$sha" -- src/database/schema.ts drizzle; then
    echo 'Database changes need a reviewed migration first; see docs/deployment.md.'
    exit 1
fi

wait_ready() {
    local offset=$1
    for ((attempt=0; attempt<60; attempt++)); do
        # Winston may rotate the file during startup.
        local size
        size=$(stat -c %s logs/combined.log 2>/dev/null || echo 0)
        if ((size < offset - 1)); then offset=1; fi
        if sudo -n systemctl is-active --quiet snoojote &&
            tail -c "+$offset" logs/combined.log 2>/dev/null | grep -q 'Bot logged in'; then
            sleep 3
            sudo -n systemctl is-active --quiet snoojote || return 1
            return 0
        fi
        sleep 1
    done
    echo 'Bot did not log in within 60 seconds.'
    return 1
}
log_offset() {
    local size=0
    [[ ! -f logs/combined.log ]] || size=$(stat -c %s logs/combined.log)
    echo "$((size + 1))"
}
rollback() {
    trap - ERR HUP INT TERM
    set +e
    echo "Deployment failed; restoring $previous"
    sudo -n systemctl stop snoojote
    git checkout --detach "$previous" && bun install --frozen-lockfile && {
        offset=$(log_offset)
        sudo -n systemctl start snoojote && wait_ready "$offset"
    }
    rollback_status=$?
    if [[ "$rollback_status" != 0 ]]; then
        echo 'ROLLBACK FAILED: inspect snoojote.service and logs/error.log immediately.'
    else
        echo 'Previous code restored. Database was not migrated or restored.'
    fi
    exit 1
}

mkdir -p "$HOME/snoojote-backups"
backup="$HOME/snoojote-backups/$(date -u +%Y%m%dT%H%M%SZ)-$previous.sqlite"
sqlite3 data/database.sqlite ".backup '$backup'"
echo "Database backup: $backup"
trap rollback ERR HUP INT TERM
sudo -n systemctl stop snoojote
# Preserve ignored runtime files and untracked server backups; never git clean/reset.
git checkout --detach "$sha"
bun install --frozen-lockfile
offset=$(log_offset)
sudo -n systemctl start snoojote
wait_ready "$offset"
# Register the commands shipped in this revision after confirming Discord login.
bun run deploy
trap - ERR HUP INT TERM
echo "Deployed $sha"
