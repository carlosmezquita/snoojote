# Automatic VPS deployment

Every push or merge to `main` runs **Quality**. After all checks and the dependency
audit pass, **Deploy VPS** deploys that exact commit to `oracle-micro`:

- Host: repository variable `VPS_HOST`, SSH user `ubuntu`.
- Checkout: `/home/ubuntu/new-snoojote`.
- Process: `snoojote.service` (the existing Screen wrapper).
- Runtime: `/home/ubuntu/.bun/bin/bun`.

No approval is required for routine deployments. From your phone, ask Codex to
implement a change and merge it into `main`; deployment follows automatically.
Changes left on a branch or in an unmerged pull request are not deployed.
GitHub's Actions tab shows **Quality** and **Deploy VPS** results.

## What happens on the VPS

The server fetches `main` and ignores superseded deployment runs. A server lock
and GitHub concurrency prevent overlapping deployments. The deployer refuses
tracked local edits, non-forward upgrades, missing runtime configuration, and
unreviewed schema changes before stopping the bot.

It creates a consistent SQLite backup in `/home/ubuntu/snoojote-backups`, stops
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

GitHub uses a dedicated Ed25519 key, stored as `VPS_DEPLOY_KEY`. Its authorized-key
entry on the VPS uses:

```text
restrict,command="/home/ubuntu/.local/bin/snoojote-deploy" ssh-ed25519 PUBLIC_KEY snoojote-github-actions
```

The forced command accepts only a full SHA matching current `origin/main`, then
runs that commit's `ops/deploy.sh`. It cannot open an interactive shell or forward
ports. Code merged to `main` runs as the bot's existing `ubuntu` user; protect
repository write access accordingly. Existing personal SSH keys are not reused.

Install the gateway once, from this repository:

```bash
install -D -m 700 ops/deploy-gateway.sh /home/ubuntu/.local/bin/snoojote-deploy
```

Store the verified VPS SSH host-key entries in `VPS_KNOWN_HOSTS` and the VPS address
in the repository variable `VPS_HOST`. The workflow requires strict host checking.
The `production` GitHub environment should allow `main` and have no required
reviewers for unattended deployment. No Discord credentials are stored in Actions.
If the gateway itself changes, reinstall the file above separately; it lives
outside the working tree so a code rollback cannot remove the SSH entry point.

## Database or runtime upgrades

The existing database may have been created with `drizzle-kit push`; automatic
deployment therefore does not apply SQL migrations or force schema pushes.
A change to `src/database/schema.ts` or `drizzle/` fails before stopping the bot.
For such a release, follow [MIGRATIONS.md](../MIGRATIONS.md), with a backup and a
reviewed migration, then write the full reviewed target commit SHA to
`/home/ubuntu/new-snoojote/.git/snoojote-schema-ref`. Do this only after applying
that release's database changes. Re-run the successful main **Quality** workflow
to trigger deployment again. Update Bun on the VPS separately if a release
requires a newer runtime. Routine application changes need neither step.

## Operations

```bash
ssh oracle-micro
sudo systemctl status snoojote
cd /home/ubuntu/new-snoojote
git log -1 --oneline
tail -n 80 logs/error.log
```

To redeploy current `main`, re-run its **Quality** workflow in GitHub Actions.
For a rollback, revert the bad change on `main`; the revert goes through the same
checks and deployment. Reverting schema changes still needs a reviewed database
plan. If automatic rollback also fails, use the service and log commands above
to investigate before starting another deployment.
