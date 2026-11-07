# Automated security maintenance

## Dependency checks and updates

GitHub's **Security monitoring** workflow audits the locked dependencies every
day at 07:17 UTC and can also run manually from Actions. It installs with
`--ignore-scripts` and has no production credentials in the dependency audit job.
New moderate-or-higher advisories fail the check, including vulnerabilities
published after the last code deployment. The normal Quality workflow also
audits every push and PR before production deployment.

Dependabot security updates are enabled. Dependabot opens assigned update PRs
for known vulnerabilities and checks Bun dependencies and pinned GitHub Actions
every Monday at 08:00 Canary time. Routine minor/patch dependency updates are
grouped; major updates remain separate. PRs run the full quality gate. Updates
are not merged automatically: after a reviewed update reaches `main`, the normal
checked deployment runs. A test pass cannot prove a dependency is trustworthy.

## VPS checks

The daily workflow uses the existing production-only SSH identity to invoke the
exact `security-check` command. The root-owned gateway dispatches this command
to `/usr/local/lib/snoojote/security-check`, running as the unprivileged bot
account. The monitoring script never opens secrets or private keys, changes
configuration, installs packages, restarts services, or reboots the server.

Checks cover the bot and update timers, selected service sandbox settings,
secret-file permissions, security infrastructure ownership, administrative
groups and excessive sudo permissions, automatic reboot policy, stale APT
metadata, pending standard security updates, pending reboots, and disk capacity.
These checks are a baseline, not a complete vulnerability or intrusion scan.

## Alerts

Each failing component opens a separate GitHub issue assigned to `carlosmezquita`.
Subsequent failures update the existing issue, and a successful check closes it.
The workflow run provides details. Assigned issue and workflow email/push
delivery follows the account's GitHub notification settings. Security findings
must be addressed or consciously accepted; do not disable failing checks just
to hide a pending maintenance requirement.

A weekly Codex review runs Mondays at 10:00 Canary time in this chat. It reviews
alerts, update PRs, VPS security posture, and advisory/release information for
the pinned Bun runtime and dependency overrides. It performs no upgrades,
merges, reboots, or service restarts. This supplemental review depends on the
local Codex automation host being available; daily GitHub checks run independently.

## OS security patches and manual reboots

The VPS already runs Ubuntu unattended security updates daily. The drop-in
`ops/99-snoojote-security-updates.conf` explicitly sets
`Unattended-Upgrade::Automatic-Reboot "false"`. The needrestart drop-in excludes
Snoojote from automatically selected restarts after OS package updates.

Reboots stay manual, including when the security monitor reports a pending
reboot. Patches that need a reboot or process restart are not fully active until
that maintenance happens. Schedule supervised maintenance and verify the bot's
Discord login afterward. The monitoring workflows do not deploy or restart code;
ordinary code deployments and crash recovery retain their existing behavior.
Pinned Bun/runtime upgrades also remain supervised maintenance.

## Installing monitoring configuration changes

As the VPS administrator, install reviewed versions of these files:

```bash
sudo install -o root -g root -m 755 ops/security-check.sh /usr/local/lib/snoojote/security-check
sudo install -o root -g root -m 755 ops/deploy-gateway.sh /usr/local/lib/snoojote/deploy-gateway
sudo install -m 644 ops/99-snoojote-security-updates.conf /etc/apt/apt.conf.d/99-snoojote-security-updates
sudo install -m 644 ops/60-snoojote-needrestart.conf /etc/needrestart/conf.d/60-snoojote.conf
sudo -H -u snoojote /usr/local/lib/snoojote/security-check
```

The check exits nonzero for anything needing attention. After resolving a finding,
run **Security monitoring** manually to verify it and close the corresponding alert.
