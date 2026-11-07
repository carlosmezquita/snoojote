#!/usr/bin/env bash
# Exercise deployment failure/recovery without SSH, systemd, or a real database.
set -Eeuo pipefail
source_dir=$(cd "$(dirname "$0")" && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
trap 'cat "$fixture/output"; cat "$fixture/calls"; echo "FAIL: ${SCENARIO:-setup} at line $LINENO"' ERR
mkdir -p "$fixture/bin" "$fixture/app" "$fixture/home"
export PATH="$fixture/bin:$PATH" HOME="$fixture/home" FIXTURE="$fixture"
export OLD_SHA=1111111111111111111111111111111111111111
export NEW_SHA=2222222222222222222222222222222222222222
sed "s|cd /opt/snoojote|cd $fixture/app|" "$source_dir/deploy.sh" > "$fixture/deploy.sh"
cat > "$fixture/bin/mock" <<'MOCK'
#!/usr/bin/env bash
set -eu
name=$(basename "$0")
echo "$name $*" >> "$FIXTURE/calls"
case "$name" in
    git)
        case "$1" in
            rev-parse) cat "$FIXTURE/revision" ;;
            status) [[ ${SCENARIO:-} != dirty ]] || echo ' M src/index.ts' ;;
            archive) tar -cf - --files-from /dev/null ;;
            diff) if [[ "$*" == *"exclude"* ]]; then [[ "$SCENARIO" == docs ]]; exit; fi
                [[ ${SCENARIO:-} != schema ]] ;;
            checkout) echo "$3" > "$FIXTURE/revision" ;;
        esac ;;
    sudo)
        case "$3" in
            stop) echo stopped > "$FIXTURE/service" ;;
            start)
                echo running > "$FIXTURE/service"
                if [[ ${SCENARIO:-} != startup || $(cat "$FIXTURE/revision") == "$OLD_SHA" ]]; then
                    echo 'Bot logged in' >> "$FIXTURE/app/logs/combined.log"
                fi ;;
            is-active) [[ $(cat "$FIXTURE/service") == running ]] ;;
        esac ;;
    bun)
        if [[ "$1" == install ]]; then
            [[ "$(cat "$FIXTURE/service")" == running && "$PWD" == */release ]]
            [[ "$SCENARIO" != install ]] || exit 1
            mkdir node_modules
            touch node_modules/prepared
        fi
        if [[ ${SCENARIO:-} == commands && "$1" == run ]]; then exit 1; fi ;;
    sqlite3)
        backup=${2#.backup }
        backup=${backup#\'}
        backup=${backup%\'}
        : > "$backup" ;;
    sleep)
        if [[ "$SCENARIO" == guard_success || "$SCENARIO" == guard_startup ]]; then
            touch "$FIXTURE/app/data/link-guard.ready"
        fi
        if [[ "$SCENARIO" == guard_success && -f "$FIXTURE/app/.git/snoojote-link-guard-ref" ]]; then
            cp "$FIXTURE/app/.git/snoojote-link-guard-ref" "$FIXTURE/app/data/link-guard.ready"
        fi ;;
esac
MOCK
chmod +x "$fixture/bin/mock"
for command in git sudo bun sqlite3 sleep; do ln -s mock "$fixture/bin/$command"; done

for scenario in success docs dirty schema install startup commands guard_offline guard_success guard_startup; do
    export SCENARIO=$scenario
    mkdir -p "$fixture/app/.git" "$fixture/app/config" "$fixture/app/data" "$fixture/app/logs"
    mkdir -p "$fixture/app/node_modules"
    rm -f "$fixture/app/node_modules/prepared"
    touch "$fixture/app/node_modules/original"
    touch "$fixture/app/.env" "$fixture/app/config/bot.config.json" "$fixture/app/data/database.sqlite"
    echo 'Old Bot logged in' > "$fixture/app/logs/combined.log"
    echo "$OLD_SHA" > "$fixture/revision"
    echo running > "$fixture/service"
    : > "$fixture/calls"
    if [[ "$scenario" == guard_* ]]; then
        touch "$fixture/app/.git/snoojote-link-guard-enabled"
        echo "$OLD_SHA" > "$fixture/app/data/link-guard.ready"
        touch -t 200001010000 "$fixture/app/data/link-guard.ready"
    fi
    result=0
    bash "$fixture/deploy.sh" "$NEW_SHA" > "$fixture/output" 2>&1 || result=$?
    if [[ "$scenario" == docs ]]; then
        [[ "$result" == 0 && $(cat "$fixture/revision") == "$NEW_SHA" ]]
        if grep -Eq 'systemctl stop|bun install|bun run deploy' "$fixture/calls"; then exit 1; fi
    elif [[ "$scenario" == guard_startup ]]; then
        [[ "$result" != 0 && $(cat "$fixture/revision") == "$NEW_SHA" ]]
        grep -q 'Primary remains online' "$fixture/output"
        [[ $(grep -c 'systemctl stop' "$fixture/calls") == 1 ]]
    elif [[ "$scenario" == success || "$scenario" == guard_success ]]; then
        [[ -f "$fixture/app/node_modules/prepared" && ! -e "$fixture/app/node_modules/original" ]]
        [[ "$result" == 0 && $(cat "$fixture/revision") == "$NEW_SHA" ]]
        grep -q "Deployed $NEW_SHA" "$fixture/output"
    else
        [[ "$result" != 0 && $(cat "$fixture/revision") == "$OLD_SHA" ]]
        [[ -f "$fixture/app/node_modules/original" && ! -e "$fixture/app/node_modules/prepared" ]]
        if [[ "$scenario" == dirty || "$scenario" == schema || "$scenario" == install || "$scenario" == guard_offline ]]; then
            if grep -q 'systemctl stop' "$fixture/calls"; then exit 1; fi
        else
            grep -q 'Previous code restored' "$fixture/output"
        fi
    fi
    [[ $(cat "$fixture/service") == running ]]
    echo "PASS: $scenario"
done
[[ -z "$(find "$HOME/snoojote-backups" -type f ! -perm 600 -print)" ]]
echo 'PASS: database backups are owner-only'

# Invalid SSH input must fail before fetching or evaluating any repository code.
sed "s|cd /opt/snoojote|cd $fixture/app|" "$source_dir/deploy-gateway.sh" > "$fixture/gateway.sh"
for input in '' main "$NEW_SHA;id" "$NEW_SHA extra" 'security-check;id' 'security-check extra'; do
    : > "$fixture/calls"
    result=0
    SSH_ORIGINAL_COMMAND="$input" bash "$fixture/gateway.sh" > "$fixture/output" 2>&1 || result=$?
    [[ "$result" != 0 ]]
    grep -q 'Expected a commit SHA' "$fixture/output"
    ! grep -q '^git ' "$fixture/calls"
done
echo 'PASS: SSH gateway rejects branch names and shell injection'
