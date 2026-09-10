import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { loadCorpus } from "../core/corpus.js";
import { answerQuestion, type FaqResult } from "../core/faq.js";
import { KimiLlm, MockLlm, type LlmProvider } from "../core/llm.js";
import { scanCorpus } from "../core/contradictions.js";
import type { ContradictionFinding } from "../core/types.js";
import {
  Community,
  draftOutreachForFlags,
  scan,
  type RadarEvent,
} from "../core/radar.js";
import { ApprovalQueue, type OutreachDraft } from "../core/approvals.js";
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
  findings: { pair: [string, string]; severity: "low" | "medium" | "high"; explanation: string }[];
}

const corpus = loadCorpus(join(rootDir, "data/corpus/ai-builders-hackathon-2026.json"));
const registry = JSON.parse(
  readFileSync(join(rootDir, "data/corpus/contradictions.verified.json"), "utf8"),
) as VerifiedRegistry;
const seed = JSON.parse(readFileSync(join(rootDir, "data/seed/community.json"), "utf8")) as SeedFile;

const now = new Date(seed.now).getTime();
const deadlineAt = new Date(seed.deadline).getTime();

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

const sent: OutreachDraft[] = [];
const queue = new ApprovalQueue(
  {
    send: (draft) => {
      sent.push(draft);
    },
    audit,
    now: () => now,
  },
  store.loadApprovals(),
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
}));

app.get("/api/radar", async () => scan(community, { now, deadlineAt }));

app.post("/api/radar/draft", async () => {
  const flags = scan(community, { now, deadlineAt });
  const existing = queue.all();
  const fresh = flags.filter(
    (f) =>
      !existing.some(
        (d) => d.memberId === f.memberId && (d.status === "pending" || d.status === "sent"),
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
    return await queue.approve(id, body.by ?? "organizer-demo");
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/approvals/:id/reject", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { by?: string; reason?: string };
  try {
    return queue.reject(id, body.by ?? "organizer-demo", body.reason);
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/audit", async () => [...audit.list()].reverse());

app.get("/api/sent", async () => sent);

app.get("/api/report", async () => ({
  markdown: generateReport({
    community,
    audit,
    corpus,
    now,
    deadlineAt,
    sponsor: {
      name: "Tin Computer",
      anchorText: "Tin Computer — the growth agent for small SaaS",
      url: "https://tin.computer/",
      deliverable: "announcement-post link placed 2026-09-03; credits claim page live",
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
  audit.record(result.decision === "answered" ? "faq.answered" : "faq.escalated", result.question, {
    citations: result.citations?.map((c) => c.docId),
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
      audit.record("contradiction.found", `${f.pair.join(" × ")} (${f.severity})`, f);
    }
  }
  await app.listen({ port, host: "127.0.0.1" });
  console.log(`greenroom server listening on http://localhost:${port} (llm: ${llm.name})`);
}

await main();
