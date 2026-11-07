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
# or force a schema push over production data. See docs/OPERATIONS.md.
schema_ref=$previous
if [[ -f .git/snoojote-schema-ref ]]; then
    schema_ref=$(cat .git/snoojote-schema-ref)
fi
if ! git diff --quiet "$schema_ref" "$sha" -- src/database/schema.ts drizzle; then
    echo 'Database changes need a reviewed migration first; see docs/OPERATIONS.md.'
    exit 1
fi

# Compare the entire deployed range. A diff error must never authorize a skip.
if git diff --quiet "$previous" "$sha" -- . ':(exclude)README.md' ':(exclude,glob)docs/**/*.md'; then
    git checkout --detach "$sha"
    echo "Deployed $sha (documentation only; service stayed online)"
    exit 0
fi

# Stage on the checkout filesystem so dependency directories can switch by rename.
# Keep the service working directory and all ignored production state in place.
stage=$(mktemp -d .git/snoojote-release.XXXXXXXX)
cleanup() {
    if [[ -e "$stage/previous-modules" ]]; then
        echo "Retained rollback dependencies at $stage/previous-modules"
    else
        rm -rf -- "$stage"
    fi
}
trap cleanup EXIT
mkdir "$stage/release"
git archive "$sha" | tar -x -C "$stage/release"
(cd "$stage/release" && bun install --frozen-lockfile)
[[ -d "$stage/release/node_modules" && -d node_modules ]]

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
guard_ready() {
    [[ "$1" =~ ^[0-9a-f]{40}$ && -f data/link-guard.ready && "$(cat data/link-guard.ready)" == "$1" ]] &&
        (( $(date +%s) - $(stat -c %Y data/link-guard.ready) < 12 ))
}
await_guard_pulse() {
    local initial
    initial=$(stat -c %Y data/link-guard.ready) || return 1
    for ((attempt=0; attempt<12; attempt++)); do
        if [[ $(stat -c %Y data/link-guard.ready) -gt $initial ]] &&
            guard_ready "$(cat data/link-guard.ready)"; then return 0; fi
        sleep 1
    done
    return 1
}
refresh_guard() {
    [[ -e .git/snoojote-link-guard-enabled ]] || return 0
    echo "$1" > .git/snoojote-link-guard-ref.tmp
    mv .git/snoojote-link-guard-ref.tmp .git/snoojote-link-guard-ref
    for ((attempt=0; attempt<60; attempt++)); do
        if guard_ready "$1"; then return 0; fi
        sleep 1
    done
    echo 'Link guard did not become ready on requested revision.'
    return 1
}
rollback() {
    trap - ERR HUP INT TERM
    set +e
    echo "Deployment failed; restoring $previous"
    sudo -n systemctl stop snoojote
    restore_modules() {
        if [[ -d "$stage/previous-modules" ]]; then
            if [[ -e node_modules ]]; then mv node_modules "$stage/failed-modules" || return 1; fi
            mv "$stage/previous-modules" node_modules || return 1
        fi
    }
    git checkout --detach "$previous" && restore_modules && {
        offset=$(log_offset)
        sudo -n systemctl start snoojote && wait_ready "$offset" && refresh_guard "$previous"
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
if [[ -e .git/snoojote-link-guard-enabled ]]; then
    # A docs-only release may have advanced HEAD without restarting either service.
    await_guard_pulse || { echo 'Link guard offline; keeping primary online.'; exit 1; }
fi
trap rollback ERR HUP INT TERM
sudo -n systemctl stop snoojote
# Preserve ignored runtime files and untracked server backups; never git clean/reset.
git checkout --detach "$sha"
mv node_modules "$stage/previous-modules"
mv "$stage/release/node_modules" node_modules
offset=$(log_offset)
sudo -n systemctl start snoojote
wait_ready "$offset"
# Register the commands shipped in this revision after confirming Discord login.
bun run deploy
trap - ERR HUP INT TERM
rm -rf -- "$stage/previous-modules"
# Primary is serving. Do not take it offline to roll back a failed standby rotation.
if ! refresh_guard "$sha"; then
    echo 'Primary remains online; inspect snoojote-link-guard.service before the next rollout.'
    exit 1
fi
echo "Deployed $sha"
