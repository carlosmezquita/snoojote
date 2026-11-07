# Automatic VPS deployment

`oracle-micro` checks GitHub `main` every two minutes using `snoojote-deploy.timer`.
New commits are checked in a temporary checkout before production changes:
locked dependency installation, deployment simulations, `bun run check`, and
`bun run audit`. This runs on the VPS and does not depend on GitHub Actions billing.
The existing GitHub Quality workflow remains available when Actions can run.

From your phone, ask Codex to implement a change and merge it into `main`.
Deployment follows automatically after the checks pass. An unmerged branch or PR
is not deployed. Check `git log -1` on the VPS to see the deployed revision.

## Deployment behavior

- VPS: `oracle-micro`, user `ubuntu`.
- Checkout: `/home/ubuntu/new-snoojote`.
- Bot process: the existing `snoojote.service` Screen wrapper.
- Runtime: `/home/ubuntu/.bun/bin/bun`.

A server lock prevents overlapping deployments. The gateway fetches `main` again
and skips superseded candidates. Tracked VPS edits, non-forward upgrades, missing
runtime files, and unreviewed schema changes stop deployment before the bot stops.

The deployer creates a consistent SQLite backup in `/home/ubuntu/snoojote-backups`,
stops the bot, checks out the tested commit, installs locked dependencies, restarts,
and waits for a fresh Discord login. It then registers slash commands. A restart
causes brief downtime and clears in-memory sessions. The checkout is intentionally
detached at the deployed SHA. Secrets, configuration, logs, and data stay on the VPS.
Deployment never runs `git clean` or automatically restores the database.

On failure, the deployer attempts to reinstall and restart the previous code.
If command registration partially succeeded before failing, rerun `bun run deploy`
from the recovered checkout to restore the previous command definitions.
Backups are retained until you remove them; check disk usage periodically.

Failed commits are recorded in `.git/snoojote-failed-deploy` so the timer does not
repeatedly run expensive checks against the same broken revision. Push a fix, or
remove that marker and start `snoojote-deploy.service` to retry after fixing a
server-side issue. A failed update leaves the current bot version running, unless
the update failed after stopping it and recovery also failed; inspect the journal.

## Monitoring and manual retry

```bash
ssh oracle-micro
systemctl list-timers snoojote-deploy.timer
sudo journalctl -u snoojote-deploy.service -n 80 --no-pager
sudo systemctl status snoojote
cd /home/ubuntu/new-snoojote
git log -1 --oneline
tail -n 80 logs/error.log
```

To retry a failed candidate:

```bash
cd /home/ubuntu/new-snoojote
rm -f .git/snoojote-failed-deploy
sudo systemctl start snoojote-deploy.service
```

For a code rollback, revert the bad change on `main`. The revert follows the same
checks and deployment. Reverting schema changes still needs a reviewed data plan.

## Database or runtime upgrades

The existing database may predate migration journaling. The deployer does not run
SQL migrations or force schema pushes. Changes to `src/database/schema.ts` or
`drizzle/` fail before stopping the bot. Follow [MIGRATIONS.md](../MIGRATIONS.md),
with a backup and a reviewed migration, then write the full reviewed target SHA to
`/home/ubuntu/new-snoojote/.git/snoojote-schema-ref`. Do this only after applying
that release's database changes. Remove the failed-deploy marker and retry.
Upgrade Bun on the VPS separately if a release needs a newer runtime. Routine
application changes need neither step.

## Installing or updating the deployment infrastructure

These scripts live outside the checkout so rollback cannot remove the entry point.
When changing them or their service definitions, reinstall the changed files:

```bash
install -D -m 700 ops/auto-deploy.sh /home/ubuntu/.local/bin/snoojote-auto-deploy
install -D -m 700 ops/deploy-gateway.sh /home/ubuntu/.local/bin/snoojote-deploy
sudo install -m 644 ops/snoojote-deploy.service /etc/systemd/system/snoojote-deploy.service
sudo install -m 644 ops/snoojote-deploy.timer /etc/systemd/system/snoojote-deploy.timer
sudo systemctl daemon-reload
sudo systemctl enable --now snoojote-deploy.timer
```

`ops/deploy.sh` and its simulations are read from each candidate commit. The VPS
uses its existing GitHub read credential. No inbound deployment endpoint, GitHub
Actions deployment secret, or paid runner is needed. Code merged to `main` runs as
the existing `ubuntu` bot user, so repository write access controls production.

To pause automatic deployment, run `sudo systemctl stop snoojote-deploy.timer`.
This leaves the bot running. Start the timer again to resume.
