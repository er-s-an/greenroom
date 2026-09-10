# Greenroom

**The AI copilot for hackathon and community organizers — with gates.**

Every answer needs a citation. Every outreach needs an approval. Every action leaves a trail.

Greenroom watches an online community (a hackathon Discord, an open-source program, a course cohort), answers participant questions *only* when it can cite an official source, spots people who are silently dropping out, and drafts organizer-approved nudges — all under deterministic guardrails, so it can be trusted with a community of thousands.

Built for the [AI Builders Hackathon 2026](https://ai-builders-hackathon-2026.devpost.com/).

## Why

This hackathon has **3,000+ participants and one Discord server**. Organizers answer the same question for the eleventh time at 2am; people register and never introduce themselves; sponsors ask for engagement reports nobody has time to compile. Existing community tools are analytics dashboards — they show you the problem but don't act on it. Generic chatbots act, but can't be trusted not to hallucinate rules to a confused participant.

Greenroom is the middle ground: an operator that is **powerful because it is constrained**.

## The three gates

1. **Citation Gate** — every sentence of an answer must cite a retrieved official document and stay inside its vocabulary (containment check). Low confidence or a failed check → deterministic escalation to a human, with a suggested route. Greenroom also refuses to act on stale information (e.g. it will not invite people to apply for a program whose deadline has passed).
2. **Approval Gate** — the copilot *drafts* outreach (a nudge to a stalled participant), but nothing is ever sent until a human organizer clicks approve in the queue.
3. **Audit Trail** — every answer, refusal, draft, approval, rejection, and send is recorded.

## Features

- **Grounded FAQ** — answers rules/logistics questions in Discord with per-sentence citations to the official docs.
- **Contradiction radar** — continuously compares official documents within a topic and alerts organizers when they disagree. (In this hackathon's own published rules, Greenroom found that the prose welcomes startup founders while the structured eligibility settings say students-only and exclude companies — a real conflict participants were already hitting.)
- **Stall radar** — participant lifecycle state machine (`registered → joined → introduced → active → submitted`); flags who is stuck where, and drafts a contextual nudge for each — into the approval queue, never directly to Discord.
- **Sponsor report** — one click generates the engagement report sponsors ask for. *(in progress)*

## Architecture

```
src/
  core/           pure logic, zero I/O, fully unit-tested offline
    corpus.ts       knowledge docs with source anchors
    retrieve.ts     BM25 retrieval over the curated corpus
    gate.ts         citation gate: per-sentence citation + containment verification
    faq.ts          the answer pipeline: retrieve → draft → gate → answer or escalate
    contradictions.ts  doc-conflict scanner (detector proposes, human registry disposes)
    radar.ts        participant state machine + deterministic stall detection
    approvals.ts    the approval queue (send function injected; nothing sends itself)
    audit.ts        append-only audit trail
    llm.ts          pluggable LLM: deterministic offline mock ⇄ Kimi K2.7 (hosted)
  sim/            CLI simulators: FAQ + full radar/approval/audit loop
  bot/            Discord adapter (discord.js) *(in progress)*
  server/         Fastify API *(in progress)*
  web/            organizer dashboard *(in progress)*
data/
  corpus/         curated knowledge base, quoted verbatim from official sources
  seed/           synthetic replica community (no real people) for demos
```

Design rule: **all decisions are deterministic and tested; the LLM only writes wording.** Swapping LLM providers cannot change what the copilot is allowed to do.

## Quickstart

```bash
pnpm install
pnpm test          # 38 unit tests: gate, pipeline, radar, approvals, persistence, generalization
pnpm sim "Can companies participate?" "when is the deadline?"
pnpm sim:radar     # full radar → draft → approve → audit loop on the seed community
pnpm sim:report    # ends in a sponsor report computed from live state
```

Hosted LLM (optional): set `KIMI_CODE_API_KEY` + `LLM=kimi` (uses Kimi K2.7 via the OpenAI-compatible `https://api.kimi.com/coding/v1` endpoint). Without a key, everything runs on the deterministic offline mock — including the demo.

## Quality evidence

- **Live adversarial eval** (`scripts/eval-live.mts`, not in CI — costs API quota): 23 real-user-style questions against hosted Kimi K2.7 — paraphrases, typos, a non-English question, stale-deadline traps, fabrication bait, off-topic. Every on-topic question answered with valid citations; every unanswerable one escalated; the stale deadline always acknowledged; the documentation-conflict alert fired where expected.
- **Repair loop**: when the gate rejects a draft, the LLM gets one retry with the gate's exact rejection reasons before a human is bothered. Wording problems get fixed; fabrications still escalate.
- **Generalization**: `test/generalize.test.ts` runs the identical pipeline on a second hackathon's official rules (Nebius × NVIDIA) with zero tuning — including the same eligibility question, which correctly gets the *opposite* answer (that event welcomes companies).
- **Persistence**: community events are appended to JSONL (replayed on boot), the audit trail is an append-only JSONL log, and approvals snapshot to disk on every mutation. Restart the server — nothing is lost.
- **UI smoke test**: `scripts/e2e.mts` boots the real server and drives the dashboard in a real browser — money moment, escalation, approval flow, audit, report.

## Privacy stance

The radar uses only public-channel metadata (joins, introduction posts, message timestamps). All outreach is human-approved before sending. No message content is used for anything beyond answering the question asked.

## Status

Built in September 2026 for the AI Builders Hackathon. Core engine (corpus, citation gate, contradiction radar, stall radar, approval queue, audit) is implemented and unit-tested. Discord adapter, web dashboard, and sponsor report are under active development.
