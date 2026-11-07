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
sed "s|cd /home/ubuntu/new-snoojote|cd $fixture/app|" "$source_dir/deploy.sh" > "$fixture/deploy.sh"
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
            diff) [[ ${SCENARIO:-} != schema ]] ;;
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
        if [[ ${SCENARIO:-} == install && "$1" == install && $(cat "$FIXTURE/revision") == "$NEW_SHA" ]]; then exit 1; fi
        if [[ ${SCENARIO:-} == commands && "$1" == run ]]; then exit 1; fi ;;
    sqlite3) : ;;
    sleep) : ;;
esac
MOCK
chmod +x "$fixture/bin/mock"
for command in git sudo bun sqlite3 sleep; do ln -s mock "$fixture/bin/$command"; done

for scenario in success dirty schema install startup commands; do
    export SCENARIO=$scenario
    mkdir -p "$fixture/app/.git" "$fixture/app/config" "$fixture/app/data" "$fixture/app/logs"
    touch "$fixture/app/.env" "$fixture/app/config/bot.config.json" "$fixture/app/data/database.sqlite"
    echo 'Old Bot logged in' > "$fixture/app/logs/combined.log"
    echo "$OLD_SHA" > "$fixture/revision"
    echo running > "$fixture/service"
    : > "$fixture/calls"
    result=0
    bash "$fixture/deploy.sh" "$NEW_SHA" > "$fixture/output" 2>&1 || result=$?
    if [[ "$scenario" == success ]]; then
        [[ "$result" == 0 && $(cat "$fixture/revision") == "$NEW_SHA" ]]
        grep -q "Deployed $NEW_SHA" "$fixture/output"
    else
        [[ "$result" != 0 && $(cat "$fixture/revision") == "$OLD_SHA" ]]
        if [[ "$scenario" == dirty || "$scenario" == schema ]]; then
            ! grep -q 'systemctl stop' "$fixture/calls"
        else
            grep -q 'Previous code restored' "$fixture/output"
        fi
    fi
    [[ $(cat "$fixture/service") == running ]]
    echo "PASS: $scenario"
done
