import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../src/server/store.js";
import { ApprovalQueue } from "../src/core/approvals.js";
import { AuditLog } from "../src/core/audit.js";
import { Community } from "../src/core/radar.js";

describe("FileStore", () => {
  it("round-trips events, audit, and approvals", async () => {
    const dir = mkdtempSync(join(tmpdir(), "greenroom-store-"));
    const store = new FileStore(dir);

    store.appendEvent({ type: "register", memberId: "u1", handle: "ada", at: 1000 });
    store.appendEvent({ type: "join", memberId: "u1", at: 2000 });
    const audit = new AuditLog((e) => store.appendAudit(e));
    audit.record("faq.answered", "q1");

    const sent: string[] = [];
    const queue = new ApprovalQueue({ send: (d) => void sent.push(d.text), audit });
    const draft = queue.submit({ memberId: "u1", handle: "ada", kind: "gone-quiet", text: "hi" });
    await queue.approve(draft.id, "org");
    store.saveApprovals(queue.all());

    // simulate restart: rebuild everything from disk
    const store2 = new FileStore(dir);
    const community = new Community();
    for (const e of store2.loadEvents()) community.ingest(e);
    expect(community.get("u1")?.state).toBe("joined");

    const audit2 = new AuditLog();
    audit2.restore(store2.loadAudit());
    expect(audit2.list().map((e) => e.kind)).toEqual([
      "faq.answered",
      "outreach.approved",
      "outreach.sent",
    ]);

    const queue2 = new ApprovalQueue({ send: () => {} }, store2.loadApprovals());
    expect(queue2.get(draft.id)?.status).toBe("sent");
    // counter continues from the restored max — no id collision
    const next = queue2.submit({ memberId: "u2", handle: "bo", kind: "gone-quiet", text: "yo" });
    expect(next.id).not.toBe(draft.id);
  });

  it("starts empty when no files exist", () => {
    const store = new FileStore(mkdtempSync(join(tmpdir(), "greenroom-empty-")));
    expect(store.loadEvents()).toEqual([]);
    expect(store.loadAudit()).toEqual([]);
    expect(store.loadApprovals()).toEqual([]);
  });
});
