import { readFileSync } from "node:fs";
import { Community, scan, draftOutreachForFlags, type RadarEvent } from "../core/radar.js";
import { ApprovalQueue } from "../core/approvals.js";
import { AuditLog } from "../core/audit.js";
import { MockLlm } from "../core/llm.js";

interface SeedFile {
  now: string;
  deadline: string;
  events: (Omit<RadarEvent, "at"> & { at: string })[];
}

const seed = JSON.parse(readFileSync("data/seed/community.json", "utf8")) as SeedFile;
const now = new Date(seed.now).getTime();
const deadlineAt = new Date(seed.deadline).getTime();

const community = new Community();
for (const e of seed.events) {
  community.ingest({ ...e, at: new Date(e.at).getTime() } as RadarEvent);
}

const audit = new AuditLog();
const sent: { handle: string; text: string }[] = [];
const queue = new ApprovalQueue({
  send: (draft) => {
    sent.push({ handle: draft.handle, text: draft.text });
  },
  audit,
  now: () => now,
});
const llm = new MockLlm();

async function main() {
  const members = community.list();
  console.log(`Greenroom radar sim — ${members.length} members, now = ${seed.now}, deadline = ${seed.deadline}\n`);

  console.log("== community board ==");
  const byState = new Map<string, string[]>();
  for (const m of members) {
    const list = byState.get(m.state) ?? [];
    list.push(m.handle);
    byState.set(m.state, list);
  }
  for (const state of ["registered", "joined", "introduced", "active", "submitted"]) {
    console.log(`  ${state.padEnd(11)} ${(byState.get(state) ?? []).join(", ") || "—"}`);
  }

  const flags = scan(community, { now, deadlineAt });
  console.log(`\n== stall radar (${flags.length} flags) ==`);
  for (const f of flags) {
    console.log(`  [${f.kind}] ${f.handle} — ${f.detail}`);
  }

  const draftIds = await draftOutreachForFlags(flags, llm, queue);
  console.log(`\n== approval queue (${draftIds.length} drafts, nothing sent yet) ==`);
  for (const d of queue.pending()) {
    console.log(`  ${d.id} → ${d.handle} [${d.kind}]`);
    console.log(`    "${d.text}"`);
  }

  console.log("\n== organizer approves the first draft ==");
  const first = draftIds[0]!;
  await queue.approve(first, "organizer-demo");
  console.log(`  sent: "${sent[0]?.text}"`);
  console.log(`  still pending: ${queue.pending().length}`);

  console.log(`\n== audit trail ==`);
  for (const e of audit.list()) console.log(`  ${e.kind}  ${e.summary}`);
}

await main();
