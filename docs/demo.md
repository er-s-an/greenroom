# Verifying Greenroom's gates (2 minutes, offline)

Greenroom's claim is that its guardrails are **deterministic and tested**, not prompt engineering. Here's how to check that claim yourself.

```bash
pnpm install
pnpm test
```

38 unit tests cover the safety properties:

| Property | Test |
|---|---|
| An answer sentence without a citation never ships | `test/gate.test.ts › blocks an uncited sentence` |
| A fabricated claim (drifts from source) never ships | `› blocks a fabricated claim that drifts from the source` |
| Citations to un-retrieved documents never ship | `› blocks citations to documents that were never retrieved` |
| Stale deadlines are never presented as open | `› requires staleness acknowledgement` |
| Off-topic questions escalate to humans instead of hallucinating | `test/faq.test.ts › escalates off-topic questions` |
| Outreach is never sent before human approval | `test/radar.test.ts › sends nothing before approval` |
| Rejected drafts can never be sent later | `› rejected drafts are never sent` |

## Try the pipeline

```bash
# Grounded FAQ with citations + the documentation-conflict alert
pnpm sim "Can companies participate?" "do I have to join Discord?" "what's the wifi password?"

# Stall radar → drafted outreach → approval gate → audit trail
pnpm sim:radar

# The full loop ending in a sponsor report computed from live state
pnpm sim:report
```

## The dashboard

```bash
pnpm build:web && pnpm dev   # http://localhost:3000
```

Four panels: **Ask** (cited answers + conflict alerts), **Stall radar** (participant lifecycle board), **Approval queue** (nothing sends without a click), **Audit trail + sponsor report**.

## The demo data

`data/seed/community.json` is a **synthetic** 12-member replica of a hackathon Discord — no real people. `data/corpus/ai-builders-hackathon-2026.json` quotes this hackathon's official rules/announcements verbatim, each with a source anchor. The eligibility contradiction Greenroom flags is real: compare `eligibility.rules_text` ("Startup founders and entrepreneurs" welcome) with `eligibility.structured` ("Students only", "Companies/professional organizations excluded") in that file — both quote the official page.

## Hosted LLM

Set `KIMI_CODE_API_KEY` to swap the offline mock for Kimi K2.7 (`kimi-for-coding` via the OpenAI-compatible endpoint). The gates behave identically either way — that's the point.
