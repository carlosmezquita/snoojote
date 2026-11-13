#!/usr/bin/env bash
# Root-owned entry point; executed without sudo by the restricted SSH account.
# Report labels and counts only; never read secrets, logs, or private keys.
set -Eeuo pipefail
export PATH=/usr/bin:/bin
problems=0
attention() { echo "ATTENTION: $*"; problems=$((problems + 1)); }
expect() { if ! "$@"; then attention "$*"; fi; }
expect systemctl is-active --quiet snoojote
expect systemctl is-enabled --quiet snoojote
expect systemctl is-enabled --quiet apt-daily.timer
expect systemctl is-enabled --quiet apt-daily-upgrade.timer
[[ "$(systemctl show snoojote -p User --value)" == snoojote ]] || attention 'Unexpected bot service account'
[[ "$(systemctl show snoojote -p NoNewPrivileges --value)" == yes ]] || attention 'Bot privilege escalation protection is disabled'
[[ "$(systemctl show snoojote -p ProtectSystem --value)" == strict ]] || attention 'Bot filesystem sandbox is disabled'
[[ "$(systemctl show apt-daily-upgrade.service -p Result --value)" == success ]] || attention 'Last OS security update job failed'
for file in /opt/snoojote/.env /opt/snoojote/config/bot.config.json; do
    [[ "$(stat -c '%U:%a' "$file")" == snoojote:600 ]] || attention 'Runtime configuration permissions changed'
done
for file in /usr/local/lib/snoojote/deploy-gateway /usr/local/lib/snoojote/security-check /etc/ssh/authorized_keys/snoojote /etc/ssh/sshd_config.d/80-snoojote.conf /etc/sudoers.d; do
    [[ "$(stat -c %U "$file")" == root ]] || attention 'Security infrastructure ownership changed'
    [[ ! -w "$file" ]] || attention 'Deployment account can edit security infrastructure'
done
if sudo -n /usr/bin/true >/dev/null 2>&1; then attention 'Deployment account has excessive sudo access'; fi
[[ -z "$(id -nG | tr ' ' '\n' | grep -E '^(sudo|adm|lxd|docker)$' || true)" ]] || attention 'Deployment account belongs to an administrative group'
apt_settings=$(apt-config dump)
grep -q '^Unattended-Upgrade::Automatic-Reboot "false";' <<< "$apt_settings" || attention 'Manual reboot policy changed'
grep -q '^APT::Periodic::Unattended-Upgrade "1";' <<< "$apt_settings" || attention 'Automatic security updates disabled'
if [[ -e /var/run/reboot-required ]]; then attention 'VPS reboot required; schedule supervised maintenance'; fi
stamp=/var/lib/apt/periodic/update-success-stamp
if [[ ! -f "$stamp" ]] || (( $(date +%s) - $(stat -c %Y "$stamp") > 172800 )); then
    attention 'Package security metadata is more than 48 hours old'
fi
counts=$(/usr/lib/update-notifier/apt-check 2>&1)
if [[ "$counts" =~ ^([0-9]+)\;([0-9]+)$ ]]; then
    echo "Pending OS updates: ${BASH_REMATCH[1]}; standard security updates: ${BASH_REMATCH[2]}"
    (( BASH_REMATCH[2] == 0 )) || attention 'OS security patches are still pending'
else
    attention 'Could not determine pending OS security updates'
fi
usage=$(df --output=pcent / | tail -n 1 | tr -dc '0-9')
(( usage < 85 )) || attention 'Root disk is at least 85 percent full'
if (( problems > 0 )); then
    echo "$problems finding(s) need attention. No services or settings were changed."
    exit 1
fi
echo 'VPS security checks passed. No services or settings were changed.'
