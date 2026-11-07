# Production operations

## Production VPS and systemd setup

Use the checkout at `/opt/snoojote` and the root-owned runtime at
`/usr/local/lib/snoojote/bun`. Set `TOKEN` and optional `GROQ_API_KEY` in
`.env`. Copy `config/bot.config.example.json` to `config/bot.config.json` and
replace the placeholder application, guild, channel and role IDs. Enable the
Server Members, Message Content and Presence intents in the Discord developer
portal. Position the bot role above the roles it manages. Run `bun run deploy`
to register commands and `bun run start` to start the gateway process.

### Deployment credentials and bootstrap

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

Install the reviewed unit from ops/snoojote.service. Validate ops/snoojote.sudoers with visudo -cf and ops/snoojote.sshd.conf with sshd -t before reloading the corresponding configuration.

## Deployment gateway and rollback

The [deployment workflow](../.github/workflows/deploy.yml) accepts a successful Quality run for a push to main. The [gateway](../ops/deploy-gateway.sh) verifies the tested SHA and dispatches the [release script](../ops/deploy.sh).

The server fetches `main` and ignores superseded deployment runs. A server lock
and GitHub concurrency prevent overlapping deployments. The deployer refuses
tracked local edits, non-forward upgrades, missing runtime configuration, and
unreviewed schema changes before stopping the bot.

Changes limited to `README.md` and Markdown files under `docs/` advance the checkout without restarting or registering commands. For other changes, the deployer extracts the tested revision into a temporary directory and installs its locked dependencies while the current bot serves traffic. Preparation failures leave the running release in place.

After preparation, it creates a consistent SQLite backup in `/var/lib/snoojote/snoojote-backups`, stops the service, checks out the tested commit, swaps dependency directories, restarts,
and waits up to 60 seconds for a fresh `Bot logged in` message. It then registers
slash commands. A restart causes brief downtime and clears in-memory sessions.
The checkout is intentionally detached at the deployed SHA. Deployment never runs
`git clean`, replaces `.env` or `config/bot.config.json`, or restores the live
database automatically.

On cutover failure, it restores the previous checkout and dependency directory and attempts to restart the service.
The Actions run stays failed even if recovery succeeds. If command registration
partially succeeded before failing, rerun `bun run deploy` from the recovered
checkout to restore the previous command definitions. Check backup disk usage
periodically; backups are retained until you remove them.

To redeploy, rerun Quality for current main. To roll back code, revert the release on main. Inspect the service with systemctl status snoojote and the application log at /opt/snoojote/logs/error.log.

## Security maintenance

### Dependency checks and updates

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

### VPS checks

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

### Alerts

Failed checks send an alert to the Discord channel configured as `channels.alerts`
in the bot's runtime configuration. The message includes component results, VPS
findings when available, and a link to the workflow run. Passing checks are silent.
An unresolved finding produces another alert on the next daily check.

GitHub sends these alerts directly through a channel-scoped Discord webhook,
even if the bot or VPS is offline. The webhook URL is stored only in the `production`
environment secret `DISCORD_SECURITY_WEBHOOK`; the bot token stays on the VPS.
The notification job has no repository write permissions and cannot mention
everyone or roles. Webhook creation/rotation is performed by an administrator
using Discord's channel integrations or the bot's channel-webhook permission.
Treat the webhook URL as a secret: it grants posting access to the alerts channel.

There are no Codex reminders or automatic security-issue assignments. Dependabot
still opens update PRs. GitHub's own workflow and PR notifications follow the
account's GitHub notification settings. Pinned Bun runtime and manually pinned
overrides still require advisory review and supervised updates; the dependency
audit does not scan the OS or the Bun executable for every possible vulnerability.

### OS security patches and manual reboots

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

### Installing monitoring configuration changes

As the VPS administrator, install reviewed versions of these files:

```bash
sudo install -o root -g root -m 755 ops/security-check.sh /usr/local/lib/snoojote/security-check
sudo install -o root -g root -m 755 ops/deploy-gateway.sh /usr/local/lib/snoojote/deploy-gateway
sudo install -m 644 ops/99-snoojote-security-updates.conf /etc/apt/apt.conf.d/99-snoojote-security-updates
sudo install -m 644 ops/60-snoojote-needrestart.conf /etc/needrestart/conf.d/60-snoojote.conf
sudo -H -u snoojote /usr/local/lib/snoojote/security-check
```

The check exits nonzero for anything needing attention. After resolving a finding,
run **Security monitoring** manually to verify it. A successful check sends no message.

## Database migrations and cutover recovery

The `drizzle/` folder contains SQL migrations and `meta/` contains Drizzle's schema snapshots
and migration journal. The application database is `data/database.sqlite`.

### Applying Schema Changes

Stop the bot and back up the database before changing its schema. With WAL mode, use SQLite’s
backup API/CLI or stop cleanly and confirm the WAL is checkpointed; copying only the main file
while uncheckpointed WAL data remains is not a complete backup. Run one bot process per
database; the Discord workflows and recovery workers assume that deployment model.

```bash
bun install --frozen-lockfile
bun run check
```

Choose the upgrade command that matches the existing database:

| Database setup                                               | Command                                              |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| Created using `drizzle-kit push` (the previous instructions) | `bunx drizzle-kit push`; review the proposed changes |
| Already tracked by Drizzle's migration journal               | `bunx drizzle-kit migrate`                           |
| New database                                                 | `bunx drizzle-kit migrate`                           |

Do not replay the full SQL migration history over an existing unjournaled schema.
After upgrading, smoke-test purchases, verification, voice rewards, and ticket creation/closure
in a staging guild before production. Local tests fake Discord and do not verify live permissions.

### Correctness and Recovery Update

Migration `0010_correctness_recovery.sql` adds the purchase journal, a unique index limiting each
user to one pending purchase, and nullable ticket context fields. Existing balances, inventory,
and tickets are preserved.

#### Pending Purchases

A balance debit and its pending purchase record commit together. Inventory and completed status,
and refunds and refunded status, also commit together. Failed delivery removes a newly granted
role before refunding; roles owned before the purchase are retained.

Unconfirmed compensation stays pending and blocks another purchase for that user. Recovery runs
at startup and every minute: it completes inventory when the role is present, refunds when it
is absent, and completes inventory for non-role purchases. Unresolved records retain `last_error`
and produce logs with their purchase ID.

Restore the missing permissions or database access and let recovery retry. Do not manually refund
while leaving a purchase pending, or manually change roles involved in a pending purchase.

#### Incomplete Tickets and Verification

A creating ticket reserves capacity before Discord channel creation. Its channel topic contains
`snoojote-ticket:<record ID>` so recovery can locate the channel if the create response is lost.
Failed cleanup retains `creation_failed` state and capacity until deletion is confirmed. Recovery
runs at startup and every five minutes. Preserve the topic marker while creation is pending.

Transcripts paginate history with an 8 MiB / 10,000-message export budget. Failed or oversized
exports preserve the ticket for manual export; closure and deletion require an available archive
channel. Discord attachment limits can still reject an upload. Migration 0013 journals verification per guild membership. Pending challenges resume with their original attempt count and deadline. Completion clears the stored answer. On startup the bot fetches current members and channels, verifies eligible joins since the last checkpoint, and repairs suspect-role denies on new channels. Recovery requires member intent, role management and channel management permissions. A failed sweep is retried every 30 seconds. On the first rollout the scan looks back one minute and adopts existing eligible suspect-role members.

### Runtime Invariants Update

Migration `0011_runtime_invariants.sql` normalizes legacy text inventory timestamps to Unix seconds,
adds indexes for answered-ticket history, and requires currency balances to be nonnegative safe
integers. It drops the obsolete economy/shop lock tables; coordination now uses synchronous SQLite
transactions and the purchase journal. It does not discard balances, inventory, or ticket history.

The balance constraint deliberately fails an upgrade if legacy balances are invalid. Investigate
and repair those records on a backup before retrying; do not silently reset user balances. Test the
upgrade against a copy of the production database first. Existing `drizzle-kit push` databases should
review the generated table-rebuild plan and normalize text `user_inventory.acquired_at` values to
Unix seconds before changing that column; the SQL migration performs this conversion for journaled
databases.

After applying a reviewed schema release, write its full commit SHA to /opt/snoojote/.git/snoojote-schema-ref, then rerun Quality. Upgrade the root-owned Bun runtime separately.

For a legacy bot cutover, preserve its config, storage, transcripts, secrets and supervisor settings. Stop the old process before starting its replacement. Import supported streak exports from data/streaks.json with bun src/scripts/importStreaks.ts. Keep the original ticket history, economy and archives accessible separately. Register commands with bun run deploy and verify a ticket lifecycle, balances and known streaks in Discord. If cutover fails, stop the new service, restore the previous configuration and command registrations, and restart the old process.

## Feature runbooks

- `/ticket wait` is the private, admin-only forecast for a **new** ticket's first staff response.
  Use `details:true` for presence, sample counts and model factors. It replaces both
  `/admin ticket-availability` and `/ticket waitdebug`; after updating the bot, run `bun run deploy`
  to replace the registered subcommands. Old registered commands redirect during the transition.
  Presence is a proxy, and missing history/roles or incomplete membership are reported explicitly.
  The displayed queue and staff snapshot are the ones used for that forecast. Running the command
  does not create a ticket or record a forecast for historical evaluation.
- Spam forms accept up to three optional PNG/JPEG/WebP/GIF screenshots (8 MiB combined). The bot
  validates image signatures and posts uploads in a separate message after the private opening
  embed; source modal URLs expire.
  Reports can still be submitted without images, with further evidence attached in the ticket.
  At most two file-transfer jobs run at once; excess submissions receive a retry message.
- Ticket closure/deletion requires a successful transcript archive in a different channel in the
  same guild that denies `ViewChannel` to `@everyone`. Restrict other role access to staff too.
  Archives include embeds (opening form answers and the announced estimate), message/author IDs,
  and actual attachment files copied to archive messages. The transcript maps each original file
  to its archive message, so retrieval does not depend on an expired CDN link. Older
  text-only archives cannot recover omitted embeds after channel deletion. Exports stop at 8 MiB or
  10,000 messages, with at most 20 attachments, 8 MiB per file and 32 MiB of files per archive.
  Oversized tickets or failed file copies remain available for retry/manual export. A failed archive
  may leave partial copies in the archive channel; the final transcript marks a completed export.
  Discord deletion failures preserve a retryable record. Discord retention is not an external backup.
- Voice sessions live in memory. Restarts begin voice accounting anew;
  abandoned verification channels are cleaned up. Voice rewards are split by Madrid calendar date.
- Streaks use configured channels and meaningful messages of at least ten characters. Daily quest
  rollover uses Madrid dates; claiming retains a rolling 24-hour cooldown.
- Scheduled sends use a local in-flight guard and Discord nonces to reduce duplicate retries.
  Discord delivery and local persistence do not form one atomic transaction; inspect channel history
  after ambiguous delivery failures before manually replaying a post.
- SQLite uses the version bundled by the pinned Bun runtime. Keep it patched; on macOS, check
  the actual SQLite version because Bun may use the system library.
- User IDs, balances, ticket metadata, and scheduled-post state persist in SQLite. Restrict transcript
  channel access and set a retention policy. AI requests send the selected reply-chain context to Groq.
- Logs rotate by size. Control verbosity and retention with `LOG_LEVEL`, `LOG_MAX_FILE_SIZE_BYTES`,
  and `LOG_MAX_FILES`. Bot/API secrets are redacted from formatted logs.

### Forecast telemetry

`bun run tickets:backtest-wait` reports initial-wait outcomes separately from forecast errors,
grouped by model version. Errors measure the wait remaining from forecast issuance for answered
initial waits only. Pending tickets are observed up to the export cutoff; requester closures,
staff closures, deletion without a reply, and observed requester unavailability are competing
outcomes, not response samples. `per-staff-capacity-v3` corrects response eligibility and counts
other pending ticket creations in the unanswered queue. It retains the v2 heuristic, which is not
a validated service-level promise or a calibrated prediction interval.

`bun run tickets:export-wait > wait-observations.csv` exports raw UTC timestamps, correctly scaled
millisecond durations, outcome provenance, and all saved forecasts, including tickets without a
forecast. Keep this operational export private. Legacy outcomes use available timestamps only;
a deleted status or unknown user does not establish when or why someone left. New outcome fields
are immutable for the initial wait, so reopening or returning cannot relabel a cancellation as a
successful initial response. Follow-up waits in reopened tickets need separate episode tracking.
Known legacy closure boundaries are retained before reopening or deletion; earlier lost episodes
cannot be reconstructed from the current ticket row.
Gateway member removals mean leave/kick/ban and are recorded at observation time. Events missed
while the bot is offline are not reconstructed. Apply migration `0012` before starting this version.
