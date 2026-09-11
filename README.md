# Greenroom

**The AI copilot for hackathon and community organizers — with gates.**

Every answer needs a citation. Every outreach needs an approval. Every action leaves a trail.

Greenroom watches an online community (a hackathon Discord, an open-source program, a course cohort), answers participant questions *only* when it can cite an official source, spots people who are silently dropping out, and drafts organizer-approved nudges — all under deterministic guardrails, so it can be trusted with a community of thousands.

Built for the [AI Builders Hackathon 2026](https://ai-builders-hackathon-2026.devpost.com/). Submission deck: [`docs/greenroom-deck.pdf`](docs/greenroom-deck.pdf) (10 pages, source: `docs/deck.html`).

## Why

This hackathon has **3,000+ participants and one Discord server**. Organizers answer the same question for the eleventh time at 2am; people register and never introduce themselves; sponsors ask for engagement reports nobody has time to compile. Existing community tools are analytics dashboards — they show you the problem but don't act on it. Generic chatbots act, but can't be trusted not to hallucinate rules to a confused participant.

Greenroom is the middle ground: an operator that is **powerful because it is constrained**.

## The three gates

1. **Citation Gate** — every sentence of an answer must cite a retrieved official document and stay inside its vocabulary (containment check). Every claim *sentence* is anchored to a single source sentence on its own and may not flip or drop the source's negation, exclusion, modal (must/may/only) or numeric content — so a flipped sentence cannot hide inside a merged citation claim. Low confidence or a failed check → deterministic escalation to a human, with a suggested route. Greenroom also refuses to act on stale information (e.g. it will not invite people to apply for a program whose deadline has passed).
2. **Approval Gate** — the copilot *drafts* outreach (a nudge to a stalled participant), but nothing is ever sent until a human organizer clicks approve in the queue. A failed send never strands a draft: it lands in `send_failed` and can be retried. Approvals are snapshotted write-ahead (before *and* after every send); a draft caught in the crash window between a real send and its snapshot comes back loudly marked `send_failed` ("outcome unknown — verify before retrying"), never silently resent.
3. **Audit Trail** — every answer, refusal, draft, approval, rejection, and send is recorded.

And when the official sources themselves disagree on the fact being asked, Greenroom **fails closed**: no verdict — the participant sees both conflicting sources verbatim, marked as a human-verified conflict, plus the route to a human organizer.

## Features

- **Grounded FAQ** — answers rules/logistics questions in Discord with per-sentence citations to the official docs.
- **Contradiction radar** — compares official documents within a topic; a detector proposes candidates, a human-verified registry disposes. Verified high-severity conflicts fail closed in the FAQ; unverified candidates wait in a review queue and never reach participants. (In this hackathon's own published rules, Greenroom surfaces a real, human-verified conflict: the prose welcomes startup founders while the structured eligibility settings say students-only and exclude companies.)
- **Stall radar** — participant lifecycle state machine (`registered → joined → introduced → active → submitted`); flags who is stuck where, and drafts a contextual nudge for each — into the approval queue, never directly to Discord.
- **Sponsor report** — one click generates the engagement report sponsors ask for, computed deterministically from the audit trail and community state.

## Architecture

```
src/
  core/           pure logic, zero I/O, fully unit-tested offline
    corpus.ts       knowledge docs with source anchors
    retrieve.ts     BM25 retrieval over the curated corpus
    gate.ts         citation gate: citation + containment + polarity/number guard
    faq.ts          the answer pipeline: retrieve → draft → gate → answer, escalate, or fail closed
    contradictions.ts  doc-conflict scanner (detector proposes, human registry disposes)
    radar.ts        participant state machine + deterministic stall detection
    approvals.ts    the approval queue (send function injected; nothing sends itself)
    audit.ts        append-only audit trail
    llm.ts          pluggable LLM: deterministic offline mock ⇄ Kimi K2.7 (hosted)
  sim/            CLI simulators: FAQ + full radar/approval/audit loop
  bot/            Discord adapter (discord.js) — implemented, not yet verified against a live guild
  server/         Fastify API + file-backed persistence (JSONL event sourcing)
  web/            organizer dashboard (React)
data/
  corpus/         curated knowledge base, quoted verbatim from official sources
  seed/           synthetic replica community (no real people) for demos
```

Design rule: **all decisions are deterministic and tested; the LLM only writes wording.** Swapping LLM providers cannot change what the copilot is allowed to do.

## Quickstart

Requires Node ≥ 20 and pnpm ≥ 9.

```bash
pnpm install
pnpm test          # 73 unit tests: gate (incl. polarity + merged-claim adversarial), pipeline, radar, approvals, persistence, generalization
pnpm sim "Can companies participate?" "when is the deadline?"
pnpm sim:radar     # full radar → draft → approve → audit loop on the seed community
pnpm sim:report    # ends in a sponsor report computed from current state
pnpm build && pnpm dev   # dashboard + API on http://localhost:3000
```

Hosted LLM (optional): set `KIMI_CODE_API_KEY` + `LLM=kimi` (uses Kimi K2.7 via the OpenAI-compatible `https://api.kimi.com/coding/v1` endpoint). Without a key, everything runs on the deterministic offline mock — including the demo.

Modes: by default the server runs an explicit **synthetic replay** (12 synthetic members, fixed demo clock, demo sender — labeled in the UI). `GREENROOM_MODE=live` switches to the wall clock; the deadline is configurable via `GREENROOM_DEADLINE`.

More checks: `pnpm e2e` (real-browser UI smoke test; Playwright is a locked devDependency — it drives system Chrome, or `pnpm exec playwright install chromium` for the bundled browser) and `pnpm eval:live` (hosted-Kimi adversarial eval; costs API quota). Both write machine-readable artifacts to `e2e-results/` and `eval-results/`, each recording the git SHA, a hash of the full source tree, the corpus hash, and the Node/pnpm/Playwright versions — recompute `sourceHash` at HEAD to verify the evidence belongs to this exact code.

## Quality evidence

- **Live adversarial eval** (`pnpm eval:live`, artifact in `eval-results/` with provider/model/date/source-tree hash/corpus hash/tool versions): 23 real-user-style questions against hosted Kimi K2.7 — paraphrases, typos, a non-English question, stale-deadline traps, fabrication bait, off-topic. Every on-topic question answered with valid citations; every unanswerable one escalated; the stale deadline always acknowledged; the verified eligibility conflict fails closed instead of shipping a one-sided verdict.
- **Polarity adversarial suite** (`test/gate.test.ts`): not/never flips, dropped negations, must↔may swaps, dropped geographic exclusions, number and date swaps — all blocked, **including when the violating sentence is merged with a faithful sentence into one citation claim**; faithful readings of the same sentences all pass.
- **Repair loop**: when the gate rejects a draft, the LLM gets one retry with the gate's exact rejection reasons before a human is bothered. Wording problems get fixed; fabrications still escalate.
- **Generalization**: `test/generalize.test.ts` runs the identical pipeline on a second hackathon's official rules (Nebius × NVIDIA) with zero tuning — including the same eligibility question, which correctly gets the *opposite* answer (that event welcomes companies).
- **Persistence**: community events are appended to JSONL (replayed on boot), the audit trail is an append-only JSONL log, and approvals snapshot atomically (tmp + rename) on every mutation — plus write-ahead snapshots around every send. Restart the server — nothing is lost, no decided draft comes back as pending, and a draft caught mid-send by a crash is flagged `send_failed` rather than resent blindly.
- **UI smoke test**: `pnpm e2e` boots the real server and drives the dashboard in a real browser — fail-closed money moment, escalation, approval → simulated send, audit, report.

## Privacy stance

The radar uses only public-channel metadata (joins, introduction posts, message timestamps). All outreach is human-approved before sending. No message content is used for anything beyond answering the question asked.

## Status

Built in September 2026 for the AI Builders Hackathon. Core engine (corpus, citation gate with per-sentence polarity guard, contradiction radar with verified/candidate separation, stall radar, approval queue with send-failure recovery and write-ahead persistence, audit, sponsor report), the Fastify server, and the React dashboard are implemented and tested (73 unit tests + a 13-check real-browser smoke test). The Discord adapter is implemented but not yet verified against a live guild; the demo runs against an explicitly labeled synthetic replay.
