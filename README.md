# Snoojote

**Stateful Community Operations & Predictive Support Engine**  
_Powering the 4,400+ member `r/Spain` Discord community in production._

Snoojote is a single-process, high-integrity backend built with **Bun, TypeScript, SQLite (WAL), and Drizzle ORM**. It consolidates support ticket workflows, real-time queue wait-time forecasting, transactional virtual economy mechanics, anti-raid verification, and bounded LLM interactions into a single deterministic runtime.

---

## Architectural Highlights

### 1. Capacity-Weighted Wait-Time Forecasting (`per-staff-capacity-v3`)

In volunteer-moderated communities with bursty traffic and shifting staff availability, naive moving averages fail to predict support latency. Snoojote implements a multi-stage statistical estimator (`src/features/tickets/services/waitTimeEstimator.ts`) backed by an offline evaluation and backtesting suite:

- **Adaptive Temporal Anchoring**: Blends recent ticket medians ($n \le 20$) with 4-hour day-of-week temporal buckets using a recency step-function ($\alpha = 0.6$ when the latest sample is $<24\text{h}$ old; $\alpha = 0.2$ during low-activity windows) to handle sparse arrival rates gracefully.
- **Responder Pool Shrinkage**: Computes a weighted median across active staff using live gateway presence (`online = 1.0`, `idle = 0.5`, `dnd = 0.25`) multiplied by a recent participation factor ($1 + 0.08 \times \min(c, 5)$). Staff members with $<5$ samples in a 90-day window fall back to the global/temporal baseline, and the active-pool blend weight ($W_{\text{blend}} \in [0, 0.3]$) scales proportionally with the fraction of statistically reliable responders online.
- **Normalized Queue Pressure**: Scales the blended baseline by the ratio of instantaneous queue load to historical median load, clamped to $[0.6\times, 3.0\times]$:
  $$L = \frac{\max(Q, 0) + 1}{\max(S_{\text{capacity}}, 0.25)}$$
- **Competing-Risks Backtesting (`tickets:backtest-wait`)**: Evaluates forecast accuracy strictly against answered initial waits while treating requester cancellations, silent closures, and member departures as competing outcomes rather than distorted response samples (`0012_ticket_wait_outcomes.sql`).

### 2. Two-Phase Transactional Economy & Crash Recovery

Discord API calls and local database mutations cannot share an atomic distributed transaction. Snoojote prevents double-spends, race conditions, and lost role deliveries through strict boundary separation:

- **Synchronous SQLite Invariants**: Currency transfers, daily claims, and shop debits execute inside synchronous SQLite transactions (`WAL` mode, `synchronous = FULL`) enforced by conditional updates and schema-level check constraints (`0011_runtime_invariants.sql`).
- **Persisted Delivery Journal & Compensation**: Role shop purchases write a durable pending state before invoking the Discord REST API (`purchaseService.ts`). If the process crashes or Discord rate-limits/fails mid-flight, boot-time recovery (`purchaseRecovery.ts`) and reconciliation loops either complete the external delivery or execute a compensating refund (`0010_correctness_recovery.sql`).
- **In-Process Concurrency Primitives**: Overlapping gateway refreshes and per-key mutations are serialized via custom `SingleFlight` (request coalescing) and `SerialQueue` primitives (`src/shared/services/`).

### 3. Security Boundaries, Privacy & Bounded AI

- **Zero-Trust Content Routing**: Starboard projections enforce strict NSFW/private-channel isolation (`starboardPrivacy.test.ts`). Public DM fallbacks automatically strip private embeds and attachments unless opted in.
- **Self-Contained Transcript Archival**: Ticket closures copy embeds, metadata, and up to 32 MiB of validated binary attachments into an access-controlled archive channel, re-mapping file references so audit trails survive Discord CDN link expiration.
- **Guarded Groq LLM Pipeline**: Contextual reply-chain AI (`@langchain/groq`) is wrapped in strict execution deadlines, concurrency semaphores, per-user cooldowns, and output sanitization (`responseSanitizer.ts`) to prevent prompt-injected mention spam.

### 4. Hardened Bare-Metal Operations & Verification

- **Synthetic Load & Invariant Testing**: 25+ test suites run against isolated in-memory SQLite instances migrated from scratch, accompanied by a synthetic 3,000-account workload benchmark (`benchmarkRuntime.ts`).
- **Locked-Down VPS Deployment**: Ships with commit-pinned GitHub Actions, automated rollback deployment scripts (`ops/deploy.sh`), `systemd` service sandboxing, and restricted `sudoers`/`sshd` configurations.

---

## Codebase Navigation (High-Signal Entry Points)

| Domain                     | Key Files                                                                                                                                                                                                                                                                                                    | What It Demonstrates                                                                               |
| :------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| **Queue Forecasting**      | [`src/features/tickets/services/waitTimeEstimator.ts`](src/features/tickets/services/waitTimeEstimator.ts)<br>[`src/features/tickets/services/waitTimeEvaluation.ts`](src/features/tickets/services/waitTimeEvaluation.ts)<br>[`src/scripts/backtestWaitEstimator.ts`](src/scripts/backtestWaitEstimator.ts) | Capacity-weighted median blending, cold-start shrinkage, and competing-risks forecast evaluation.  |
| **Concurrency & Recovery** | [`src/shared/services/SingleFlight.ts`](src/shared/services/SingleFlight.ts)<br>[`src/shared/services/SerialQueue.ts`](src/shared/services/SerialQueue.ts)<br>[`src/features/economy/services/purchaseService.ts`](src/features/economy/services/purchaseService.ts)                                         | Request coalescing, deterministic sequential queues, and journaled two-phase purchase recovery.    |
| **Moderation & Anti-Raid** | [`src/features/moderation/services/VerificationService.ts`](src/features/moderation/services/VerificationService.ts)<br>[`src/features/moderation/events/memberJoinTrap.ts`](src/features/moderation/events/memberJoinTrap.ts)                                                                               | Session-bound canvas CAPTCHA state machines, invite cache diffing, and automated raid traps.       |
| **Invariant Test Suite**   | [`test/economyInvariants.test.ts`](test/economyInvariants.test.ts)<br>[`test/securityBoundaries.test.ts`](test/securityBoundaries.test.ts)<br>[`test/runtimePerformance.test.ts`](test/runtimePerformance.test.ts)                                                                                           | Concurrency stress tests, financial conservation invariants, and permission boundary verification. |
| **Production Ops**         | [`ops/deploy.sh`](ops/deploy.sh)<br>[`ops/security-check.sh`](ops/security-check.sh)<br>[`.github/workflows/`](.github/workflows/)                                                                                                                                                                           | Zero-PaaS Linux deployment gateway, SSH/systemd hardening, and CI quality gates.                   |

---

## Quick Start & Verification

**Prerequisites:** [Bun `1.4.4`](https://bun.sh) (pinned in `package.json`) and Node.js `22` (for tooling).

```bash
git clone https://github.com/carlosmezquita/snoojote.git
cd snoojote
bun install --frozen-lockfile
cp .env.example .env
cp config/bot.config.example.json config/bot.config.json
mkdir -p data
bunx drizzle-kit migrate
```

### Verification & Benchmarking Commands

All tests execute against isolated in-memory SQLite databases with full migration application and zero external network dependencies:

```bash
bun run check                 # Full quality gate: TypeScript, ESLint, Prettier, Drizzle check, and test suite
bun test                      # Run 25+ unit, invariant, and security boundary test suites
bun run bench:runtime         # Run synthetic 3,000-account economy concurrency benchmark
bun run tickets:backtest-wait # Evaluate wait-time estimator accuracy across historical ticket outcomes
bun run audit                 # Verify zero moderate/high/critical dependency advisories
```

## Documentation

- [**System Architecture & Forecasting Model (`docs/ARCHITECTURE.md`)**](docs/ARCHITECTURE.md)
- [**Production Operations, Security & Migrations (`docs/OPERATIONS.md`)**](docs/OPERATIONS.md)

## License

[ISC](LICENSE)
