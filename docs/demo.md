# Verifying Greenroom's gates (2 minutes, offline)

Greenroom's claim is that its guardrails are **deterministic and tested**, not prompt engineering. Here's how to check that claim yourself.

```bash
pnpm install
pnpm test
```

73 unit tests cover the safety properties:

| Property | Test |
|---|---|
| An answer sentence without a citation never ships | `test/gate.test.ts › blocks an uncited sentence` |
| A fabricated claim (drifts from source) never ships | `› blocks a fabricated claim that drifts from the source` |
| Citations to un-retrieved documents never ship | `› blocks citations to documents that were never retrieved` |
| A claim that flips the source's negation never ships | `› blocks the not-flip` (+ never-flip, dropped-negation cases) |
| A must↔may swap never ships | `› blocks a must→may swap` |
| A dropped geographic exclusion never ships | `› blocks a dropped geographic exclusion` |
| Swapped numbers/dates never ship | `› blocks a number swap`, `› blocks a date flip` |
| A violating sentence merged into one citation claim with a faithful sentence never ships | `› merged citation claims cannot smuggle violations` (5 cases) |
| A verified doc conflict fails closed — no one-sided verdict | `test/faq.test.ts › money moment: 'Can companies participate?' fails closed` |
| Unverified detector candidates never reach participants | `› never surfaces unverified detector candidates` |
| Stale deadlines are never presented as open | `test/gate.test.ts › requires staleness acknowledgement` |
| Off-topic questions escalate to humans instead of hallucinating | `test/faq.test.ts › escalates off-topic questions` |
| Deadline answers never mix in another program's dates | `› deadline smoke cites ONLY this event's deadline` |
| Outreach is never sent before human approval | `test/radar.test.ts › sends nothing before approval` |
| Rejected drafts can never be sent later | `› rejected drafts are never sent` |
| A failed send lands in send_failed and retry recovers it | `› a failing sender lands in send_failed` |
| Demo sends are labeled simulated, never "sent" | `› marks demo-sender outcomes as simulated` |
| A crash mid-send comes back flagged, never silently resent | `› recoverUnknownDeliveries flags crash-window drafts` |
| Decisions survive restarts (incl. rejections and send failures) | `test/store.test.ts` |

## Try the pipeline

```bash
# Grounded FAQ — companies question fails closed on the verified conflict;
# Discord question answers with citations; wifi password escalates
pnpm sim "Can companies participate?" "do I have to join Discord?" "what's the wifi password?"

# Stall radar → drafted outreach → approval gate → audit trail
pnpm sim:radar

# The full loop ending in a sponsor report computed from current state
pnpm sim:report
```

## The dashboard

```bash
pnpm build && pnpm dev   # http://localhost:3000
```

Five panels: **Ask** (cited answers, fail-closed conflict card), **Doc conflicts** (verified findings vs. candidates awaiting review), **Stall radar** (participant lifecycle board), **Approval queue** (nothing sends without a click; simulated sends are labeled), **Audit trail + sponsor report**.

The dashboard runs in **synthetic replay** mode by default and says so in the top bar: 12 synthetic members, a fixed demo clock, and a demo sender whose receipts are marked `simulated`. `GREENROOM_MODE=live` switches to the wall clock.

## The demo data

`data/seed/community.json` is a **synthetic** 12-member replica of a hackathon Discord — no real people. `data/corpus/ai-builders-hackathon-2026.json` quotes this hackathon's official rules/announcements verbatim, each with a source anchor. The eligibility contradiction Greenroom surfaces is real and human-verified: compare `eligibility.rules_text` ("Startup founders and entrepreneurs" welcome) with `eligibility.structured` ("Students only", "Companies/professional organizations excluded") in that file — both quote the official page.

## Hosted LLM

Set `KIMI_CODE_API_KEY` to swap the offline mock for Kimi K2.7 (`kimi-for-coding` via the OpenAI-compatible endpoint). The gates behave identically either way — that's the point.
