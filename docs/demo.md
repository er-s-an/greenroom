# Greenroom — The Space Before Send

The 140-second English film follows one question from a synthetic organizer's late-night inbox to a held draft with inspectable sources. The product recording comes from the September 12 hosted Kimi run summarized in [the evidence notes](evidence/hosted-hero.md).

## Walkthrough

1. Open the organizer workbench. Asha and the community are visibly labeled synthetic.
2. Ask `can companies participate??` and select **Run source check**.
3. Inspect the model draft. The recorded Kimi run returned: “Companies/professional organizations excluded from participation.”
4. Greenroom holds the draft because it touches a high-severity eligibility issue already registered by a human during source review.
5. Read both sources. The rules' founder language and structured student/company restriction require clarification; they do not establish a final ruling by themselves.
6. Inspect the saved organizer contact and the `faq.conflicted` audit. Contact information is displayed; nobody is assigned or notified.

The film's paper plane is a visual metaphor for the pause before sending. It is not a recording of a live Discord message being intercepted. Large paper source plates enlarge the actual wording for readability. The recorded UI, source excerpts and audit come from the same hosted take.

## Local reproduction

```bash
pnpm install
pnpm build
pnpm dev
```

Open `http://localhost:3000`. The default offline provider is labeled as a test double. Its success is local workflow evidence, not a fresh hosted model run.

To use a hosted provider, configure the local credential securely and run `LLM=kimi pnpm dev`. This can consume quota for both startup candidate proposals and FAQ drafting. The published recorded take deliberately skipped startup model candidate generation and loaded the existing human-reviewed registry; its FAQ request genuinely called Kimi. It required one request and no repair.

## What the result means

The draft is held. The sources and their review provenance stay visible. The saved contact comes from the September 10 source snapshot and must be checked before use; a later official-page check found different contact information. The question remains open for a human.

The release fixes old display strings that suggested an owner had been assigned or that a particular backend Kimi version was verified. These are copy corrections, not new assignment or notification functionality. The original film footage is retained as recorded; the submitted narrative does not repeat those unsupported claims.

The secondary radar → draft → human approval → simulated delivery → audit/report workflow is available below the main workbench. It uses synthetic data and does not send Discord messages.

## Checks

`pnpm test`, `pnpm typecheck`, `pnpm build` and `pnpm e2e` verify the local release. One recorded hosted hero is not a full adversarial evaluation. Live Discord, real organizer adoption, measured participant outcomes and unknown-conflict discovery accuracy are not established.
