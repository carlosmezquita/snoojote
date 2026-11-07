# Automatic VPS deployment

Every push or merge to `main` runs **Quality**. After all checks and the dependency
audit pass, **Deploy VPS** deploys that exact commit to `oracle-micro`:

- Host: production environment variable `VPS_HOST`, SSH user `snoojote`.
- Checkout: `/opt/snoojote`.
- Process: hardened `snoojote.service`, running directly as `snoojote`.
- Runtime: root-owned `/usr/local/lib/snoojote/bun`.

No approval is required for routine deployments. From your phone, ask Codex to
implement a change and merge it into `main`; deployment follows automatically.
Changes left on a branch or in an unmerged pull request are not deployed.
GitHub's Actions tab shows **Quality** and **Deploy VPS** results.

## What happens on the VPS

The server fetches `main` and ignores superseded deployment runs. A server lock
and GitHub concurrency prevent overlapping deployments. The deployer refuses
tracked local edits, non-forward upgrades, missing runtime configuration, and
unreviewed schema changes before stopping the bot.

It creates a consistent SQLite backup in `/var/lib/snoojote/snoojote-backups`, stops
the service, checks out the tested commit, installs locked dependencies, restarts,
and waits up to 60 seconds for a fresh `Bot logged in` message. It then registers
slash commands. A restart causes brief downtime and clears in-memory sessions.
The checkout is intentionally detached at the deployed SHA. Deployment never runs
`git clean`, replaces `.env` or `config/bot.config.json`, or restores the live
database automatically.

On deployment failure, it attempts to reinstall and restart the previous code.
The Actions run stays failed even if recovery succeeds. If command registration
partially succeeded before failing, rerun `bun run deploy` from the recovered
checkout to restore the previous command definitions. Check backup disk usage
periodically; backups are retained until you remove them.

## Deployment credentials and bootstrap

GitHub uses a dedicated Ed25519 key, stored as `VPS_DEPLOY_KEY` in the `production`
environment, which permits only the `main` branch. It is not a repository-wide
secret. Its root-owned `/etc/ssh/authorized_keys/snoojote` entry uses:

```text
restrict,command="/usr/local/lib/snoojote/deploy-gateway" ssh-ed25519 PUBLIC_KEY snoojote-production-actions
```

The forced command accepts a full SHA matching current `origin/main` to run that
commit's `ops/deploy.sh`, or the exact `security-check` command to run the root-owned,
unprivileged monitoring script. It cannot open an interactive shell or forward
ports. The SSH daemon independently forces the same gateway for this account.
The dedicated account is not in `sudo`, `lxd`, or other administrative groups.
Its sudoers rule permits only the exact bot start, stop, and status commands.
It fetches the public repository over HTTPS and holds no personal GitHub key.
Existing personal SSH keys are not reused.

Install the gateway once, from this repository:

```bash
sudo install -o root -g root -m 755 ops/deploy-gateway.sh /usr/local/lib/snoojote/deploy-gateway
```

Store the verified VPS SSH host-key entries in `VPS_KNOWN_HOSTS` and the VPS address
in the production environment variable `VPS_HOST`. The workflow requires strict host checking.
The `production` GitHub environment should allow `main` and have no required
reviewers for unattended deployment. No Discord credentials are stored in Actions.
If the gateway itself changes, reinstall the file above separately; it lives
outside the working tree so a code rollback cannot remove the SSH entry point.

The bot service has `NoNewPrivileges=true`, an empty capability set, a private
temporary directory, and a read-only filesystem except for its data and logs.
It cannot use the deployment account's sudo permissions, edit code or SSH
configuration, or access the administrator's home directory. Secrets and new
backups use owner-only permissions. The SSH gateway is root-owned.

The deployment workflow accepts successful pushes to this repository's `main`
only. It does not check out PR code, download PR artifacts, or restore shared
caches. Fork pull requests run the unprivileged quality workflow without
production secrets. Quality actions are pinned to commit SHAs, and checkout
does not persist its GitHub token. Repository secret scanning and push protection
are enabled; main is protected against deletion and force pushes.

Repository write access remains a production trust boundary: code you merge to
`main` and its dependencies can access the bot token and its data. The sandbox
limits host access; it does not make malicious merged code safe. No manual approval
is required for normal deployments.

## Database or runtime upgrades

The existing database may have been created with `drizzle-kit push`; automatic
deployment therefore does not apply SQL migrations or force schema pushes.
A change to `src/database/schema.ts` or `drizzle/` fails before stopping the bot.
For such a release, follow [MIGRATIONS.md](../MIGRATIONS.md), with a backup and a
reviewed migration, then write the full reviewed target commit SHA to
`/opt/snoojote/.git/snoojote-schema-ref`. Do this only after applying
that release's database changes. Re-run the successful main **Quality** workflow
to trigger deployment again. Update Bun on the VPS separately if a release
requires a newer runtime. Routine application changes need neither step.

## Operations

```bash
ssh oracle-micro
sudo systemctl status snoojote
sudo -u snoojote git -C /opt/snoojote log -1 --oneline
sudo tail -n 80 /opt/snoojote/logs/error.log
```

To redeploy current `main`, re-run its **Quality** workflow in GitHub Actions.
For a rollback, revert the bad change on `main`; the revert goes through the same
checks and deployment. Reverting schema changes still needs a reviewed database
plan. If automatic rollback also fails, use the service and log commands above
to investigate before starting another deployment.

Host configuration is versioned in `ops/snoojote.service`, `ops/snoojote.sudoers`,
and `ops/snoojote.sshd.conf`. Install changes as the administrator, validate
sudoers with `visudo -cf` and SSH configuration with `sshd -t` before reloading.
Do not grant the deployment account permission to edit these files or reload
systemd definitions. Keep runtime upgrades and infrastructure changes separate
from routine application deployments.

See [security maintenance](security-maintenance.md) for automated checks,
dependency updates, alerts, and the manual reboot policy.
