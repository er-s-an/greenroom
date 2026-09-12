import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { loadCorpus } from "../core/corpus.js";
import { answerQuestion, faqAuditKind, type FaqResult } from "../core/faq.js";
import { KimiLlm, MockLlm, type LlmProvider } from "../core/llm.js";
import { scanCorpus } from "../core/contradictions.js";
import type { ContradictionFinding } from "../core/types.js";
import {
  Community,
  draftOutreachForFlags,
  scan,
  type RadarEvent,
} from "../core/radar.js";
import { ApprovalQueue, recoverUnknownDeliveries, type OutreachDraft } from "../core/approvals.js";
import { AuditLog } from "../core/audit.js";
import { generateReport } from "../core/report.js";
import { FileStore } from "./store.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, "..", "..");

interface SeedFile {
  now: string;
  deadline: string;
  events: (Omit<RadarEvent, "at"> & { at: string })[];
}

interface VerifiedRegistry {
  findings: {
    pair: [string, string];
    severity: "low" | "medium" | "high";
    explanation: string;
    verifiedBy?: string;
    anchors?: [string, string];
  }[];
}

/**
 * Demo mode is explicit: without GREENROOM_MODE=live the server replays the
 * synthetic 12-member seed at the seed's fixed clock, and every API response
 * is labeled `synthetic-replay`. In live mode the wall clock is used and the
 * deadline comes from GREENROOM_DEADLINE (falling back to the seed value).
 */
const LIVE = process.env.GREENROOM_MODE === "live";

const corpus = loadCorpus(join(rootDir, "data/corpus/ai-builders-hackathon-2026.json"));
const registry = JSON.parse(
  readFileSync(join(rootDir, "data/corpus/contradictions.verified.json"), "utf8"),
) as VerifiedRegistry;
const seed = JSON.parse(readFileSync(join(rootDir, "data/seed/community.json"), "utf8")) as SeedFile;
// The checked-in community is synthetic in every clock mode. `live` changes
// time/deadline only; truth labels must follow the data actually loaded.
const SYNTHETIC_COMMUNITY = seed.events.length > 0;

const now = LIVE ? Date.now() : new Date(seed.now).getTime();
const deadlineAt = process.env.GREENROOM_DEADLINE
  ? new Date(process.env.GREENROOM_DEADLINE).getTime()
  : new Date(seed.deadline).getTime();

const llm: LlmProvider =
  process.env.LLM === "kimi" && process.env.KIMI_CODE_API_KEY ? new KimiLlm() : new MockLlm();

const community = new Community();
for (const e of seed.events) {
  community.ingest({ ...e, at: new Date(e.at).getTime() } as RadarEvent);
}

// --- persistence: survive restarts -----------------------------------------
const store = new FileStore(process.env.GREENROOM_DATA_DIR ?? join(rootDir, "data/runtime"));
for (const e of store.loadEvents()) {
  community.ingest(e);
}

const audit = new AuditLog((e) => store.appendAudit(e));
audit.restore(store.loadAudit());
const hasRecordedFindings = audit.list().some((e) => e.kind === "contradiction.found");

// Demo sender: records a receipt but delivers nothing. The `simulated` status
// is deliberate — the UI and audit trail must never imply a real Discord DM.
// persistDrafts is the write-ahead hook: the queue snapshots before and after
// every send, so a crash mid-send restores a loudly-flagged send_failed, not
// a silent pending resend.
const queue = new ApprovalQueue(
  {
    send: (draft) => ({ simulated: true, reference: `sim:${draft.id}@${new Date(now).toISOString()}` }),
    audit,
    now: () => now,
    persist: () => persistDrafts(),
  },
  recoverUnknownDeliveries(store.loadApprovals()),
);
const persistDrafts = () => store.saveApprovals(queue.all());

let findings: ContradictionFinding[] = [];

const app = Fastify({ logger: false });

app.get("/api/state", async () => ({
  now: new Date(now).toISOString(),
  deadline: new Date(deadlineAt).toISOString(),
  event: corpus.event,
  members: community.list(),
  provider: llm.name,
  mode: LIVE ? ("live" as const) : ("synthetic-replay" as const),
  synthetic: SYNTHETIC_COMMUNITY,
}));

app.get("/api/radar", async () => scan(community, { now, deadlineAt }));

app.post("/api/radar/draft", async () => {
  const flags = scan(community, { now, deadlineAt });
  const existing = queue.all();
  const fresh = flags.filter(
    (f) =>
      !existing.some(
        (d) =>
          d.memberId === f.memberId &&
          ["pending", "approved", "send_failed", "simulated", "sent"].includes(d.status),
      ),
  );
  const ids = await draftOutreachForFlags(fresh, llm, queue, audit);
  persistDrafts();
  return { created: ids.map((id) => queue.get(id)).filter((d): d is OutreachDraft => !!d) };
});

app.get("/api/approvals", async () => {
  const drafts = queue.all();
  return [...drafts].sort((a, b) => {
    const rank = (d: OutreachDraft) => (d.status === "pending" ? 0 : 1);
    return rank(a) - rank(b) || a.createdAt - b.createdAt;
  });
});

app.post("/api/approvals/:id/approve", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { by?: string };
  try {
    const draft = await queue.approve(id, body.by ?? "organizer-demo");
    persistDrafts();
    return draft;
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/approvals/:id/reject", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { by?: string; reason?: string };
  try {
    const draft = queue.reject(id, body.by ?? "organizer-demo", body.reason);
    persistDrafts();
    return draft;
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/approvals/:id/retry", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    const draft = await queue.retrySend(id);
    persistDrafts();
    return draft;
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/audit", async () => [...audit.list()].reverse());

/** Outbound history — straight from the queue, so status semantics stay honest. */
app.get("/api/outbound", async () =>
  queue.all().filter((d) => d.status === "sent" || d.status === "simulated" || d.status === "send_failed"),
);

/**
 * The contradiction review queue. Verified findings and unverified detector
 * candidates are both listed — clearly labeled, never merged into one fact.
 */
app.get("/api/contradictions", async () => findings);

app.get("/api/report", async () => ({
  markdown: generateReport({
    community,
    audit,
    corpus,
    now,
    deadlineAt,
    mode: SYNTHETIC_COMMUNITY ? "synthetic-replay" : "live",
    sponsor: {
      name: "Tin Computer",
      anchorText: "Tin Computer — the growth agent for small SaaS",
      url: "https://tin.computer/",
      // No delivery claim here: a deliverable only appears when an organizer
      // configures one via GREENROOM_SPONSOR_DELIVERABLE after really doing it.
      ...(process.env.GREENROOM_SPONSOR_DELIVERABLE
        ? { deliverable: process.env.GREENROOM_SPONSOR_DELIVERABLE }
        : {}),
    },
  }),
}));

app.post("/api/ask", async (req, reply) => {
  const body = (req.body ?? {}) as { question?: unknown };
  if (typeof body.question !== "string" || body.question.trim().length === 0) {
    return reply.code(400).send({ error: "body.question must be a non-empty string" });
  }
  const result: FaqResult = await answerQuestion(body.question, corpus, llm, {
    conflicts: findings,
  });
  audit.record(faqAuditKind(result), result.question, {
    citations: result.citations?.map((c) => c.docId),
    conflict: result.conflict?.pair,
    alerts: result.alerts?.length ?? 0,
    reasons: result.escalation?.reasons,
  });
  return result;
});

const webDist = join(rootDir, "web", "dist");
await app.register(fastifyStatic, { root: webDist });
app.setNotFoundHandler((req, reply) => {
  if (req.raw.url?.startsWith("/api/")) {
    return reply.code(404).send({ error: "not found" });
  }
  return reply.sendFile("index.html");
});

const port = Number(process.env.PORT ?? 3000);

async function main() {
  findings = await scanCorpus(corpus, llm, registry);
  if (!hasRecordedFindings) {
    for (const f of findings) {
      // Candidates are recorded as candidates — the audit trail keeps the
      // verified/unverified distinction instead of merging them into one fact.
      audit.record(
        "contradiction.found",
        `${f.verified ? "verified" : "candidate"}: ${f.pair.join(" × ")} (${f.severity})`,
        f,
      );
    }
  }
  await app.listen({ port, host: "127.0.0.1" });
  console.log(
    `greenroom server listening on http://localhost:${port} (llm: ${llm.name}, mode: ${LIVE ? "live" : "synthetic-replay"})`,
  );
}

await main();
