# Greenroom

**Let AI draft. Keep the decision accountable.**

Greenroom is a source-checked copilot for community and hackathon organizers. It retrieves official material, drafts a reply, checks its claims, and holds the draft when an existing reviewed issue still needs a human decision.

At 2:07 AM, Asha receives a question: **“Can our company enter?”** She is a synthetic volunteer-organizer persona; the consequence is easy to recognize. A team may treat one confident answer as permission to spend days building. Greenroom makes the draft, its sources and the reason for holding it visible together.

[Ten-page deck](docs/greenroom-deck.pdf) · [Editable deck](docs/deck.html) · [Demo walkthrough](docs/demo.md) · [Hosted-run evidence](docs/evidence/hosted-hero.md)

Built for the [AI Builders Hackathon 2026](https://ai-builders-hackathon-2026.devpost.com/).

## One question, one accountable outcome

The demo uses a curated September 10, 2026 snapshot of public event material. Rules prose includes startup founders; structured eligibility says students only and excludes companies. A founder and a company are not necessarily the same thing. A human registered this issue for clarification during corpus review.

1. The organizer asks `can companies participate??`.
2. BM25 retrieval selects relevant official source text.
3. Kimi drafts a source-cited sentence.
4. Deterministic checks examine the wording and the existing human-reviewed issue registry.
5. Greenroom withholds the draft, shows both source excerpts and the saved organizer contact, and records `faq.conflicted`.

The contact is displayed for investigation. No case is automatically assigned and no person is notified. The question remains open; an unsupported final ruling stays unsent.

## What runs today

- **FAQ workbench:** retrieval → draft → citation/source checks → answer, escalation or held draft. The organizer can inspect the draft and source pair.
- **Reviewed-issue gate:** a detector may propose candidates; the human-reviewed registry determines which high-severity issues block a reply. The showcased issue was registered by a human. Unknown-conflict discovery accuracy is unmeasured.
- **Secondary local workflow:** a participant lifecycle model identifies stalled synthetic participants, drafts outreach into an approval queue, and records approval, rejection and simulated delivery.
- **Audit and report:** file-backed event history and approval snapshots support an inspectable trail and a deterministic sponsor report.
- **Discord adapter:** implemented separately, but not composed into the demonstrated workbench or verified against a live guild.

**AI produces drafts. Deterministic gates control whether those drafts may become answers.** Swapping providers does not bypass the gates.

## Run locally

Requires Node 20 or newer and pnpm 9 or newer.

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

Open `http://localhost:3000` and click **Run source check** for the prefilled question. With no provider configured, this is an explicitly labeled offline test double. The community, persona and sender are synthetic.

For optional hosted drafting, configure `KIMI_CODE_API_KEY` securely in your local environment, then run `LLM=kimi pnpm dev`. The adapter uses the configured Kimi endpoint and the `kimi-for-coding` model alias. Startup candidate generation and FAQ requests consume provider quota. Never place credentials in tracked files or recordings. A hosted call is not needed to run the offline tests or inspect the submitted evidence.

`GREENROOM_MODE=live` changes the clock and deadline only. It does not connect a Discord bot or replace the synthetic seed.

## Architecture

```text
src/core/       retrieval, draft/source gate, reviewed issues, radar, approvals, audit
src/server/     Fastify API and file-backed persistence
src/bot/        separate Discord adapter
src/sim/        local FAQ, radar and report simulators
web/src/        React organizer workbench
data/corpus/    curated public source snapshots and human-reviewed registry
data/seed/      synthetic demonstration community
```

The source gate checks citations, sentence anchors, negation/exclusion, modal qualifiers, dates and numbers. A failed draft may receive one repair attempt. Leading standalone “Yes” or “No” particles must be rewritten as complete source-verifiable statements. If the repaired wording is still unsafe, it is escalated.

Outreach requires human approval. The local sender records `simulated`, not `sent`. After a real sender failure or unknown crash-window outcome, an operator must inspect provider state before retrying; no provider-level exactly-once delivery is claimed.

## Evidence and limits

A recorded September 12 run made **one real Kimi request**, received a draft, and exercised the held-result/source/contact/audit path. The 140-second English film and deck use that run. The observed model response alias was `kimi-for-coding`; no backend version is inferred from it. See the [redacted evidence summary](docs/evidence/hosted-hero.json).

The captured behavior tree has source hash `1eddf6d51b37191e` and corpus hash `46803dd9cd17b4ea`. This release retains that core runtime and corpus, with small display-copy corrections and the matching UI assertion update after filming. [Evidence notes](docs/evidence/hosted-hero.md) distinguish the recorded tree from the release tree. This one hero pass does not establish a full current-source hosted evaluation. Historical files in `eval-results/` describe their own recorded source hashes only.

This release passed **78 offline tests, both TypeScript checks, the production build, and 13 browser smoke checks**. The deck contains exactly ten pages. [Release check summary](docs/evidence/release-checks.json).

Existing verification commands:

```bash
pnpm test       # offline regression tests, including source-gate adversarial cases
pnpm typecheck # server/core and browser TypeScript
pnpm build     # production web bundle
pnpm e2e       # real browser + local mock provider and simulated sender
```

`pnpm eval:live` and `pnpm smoke:kimi` use real provider quota and are separate optional checks. They were not rerun to publish this release.

The source snapshot's contact information is archived, not verified-current contact information. Before use, check the current official event page. Live organizer adoption, measured impact, consent/opt-out handling, real community feeds, live Discord operation and new-conflict precision/recall remain unverified or unimplemented. The demo proves a visible held draft and evidence trail, not a final eligibility ruling.
