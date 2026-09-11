import { describe, expect, it } from "vitest";
import { Community, scan, draftOutreachForFlags, type RadarEvent } from "../src/core/radar.js";
import { ApprovalQueue, recoverUnknownDeliveries } from "../src/core/approvals.js";
import { AuditLog } from "../src/core/audit.js";
import { MockLlm } from "../src/core/llm.js";

const H = 3_600_000;
const T0 = new Date("2026-09-10T00:00:00Z").getTime();
const DEADLINE = new Date("2026-09-16T03:00:00Z").getTime();

function replay(events: RadarEvent[]): Community {
  const c = new Community();
  for (const e of events) c.ingest(e);
  return c;
}

describe("community state machine", () => {
  it("moves members forward through the lifecycle", () => {
    const c = replay([
      { type: "register", memberId: "u1", handle: "ada", at: T0 },
      { type: "join", memberId: "u1", at: T0 + 1 * H },
      { type: "introduce", memberId: "u1", at: T0 + 2 * H, text: "hi" },
      { type: "message", memberId: "u1", at: T0 + 3 * H, channel: "general", text: "hey" },
      { type: "submit", memberId: "u1", at: T0 + 4 * H },
    ]);
    expect(c.get("u1")?.state).toBe("submitted");
  });

  it("never moves members backward", () => {
    const c = replay([
      { type: "register", memberId: "u1", handle: "ada", at: T0 },
      { type: "introduce", memberId: "u1", at: T0 + 1 * H, text: "hi" },
      { type: "join", memberId: "u1", at: T0 + 2 * H }, // late event, must not regress
    ]);
    expect(c.get("u1")?.state).toBe("introduced");
  });

  it("a late duplicate register refreshes facts but never drags state back", () => {
    const c = replay([
      { type: "register", memberId: "u1", handle: "ada", at: T0 },
      { type: "submit", memberId: "u1", at: T0 + 4 * H },
      { type: "register", memberId: "u1", handle: "ada-renamed", at: T0 + 5 * H },
    ]);
    const m = c.get("u1");
    expect(m?.state).toBe("submitted");
    expect(m?.stateSince).toBe(T0 + 4 * H);
    expect(m?.handle).toBe("ada-renamed");
  });
});

describe("stall radar", () => {
  it("flags each stall kind with the most actionable rule", () => {
    const now = new Date("2026-09-13T06:00:00Z").getTime(); // 69h before deadline
    const c = replay([
      { type: "register", memberId: "nojoin", handle: "a", at: T0 },
      { type: "register", memberId: "nointro", handle: "b", at: T0 },
      { type: "join", memberId: "nointro", at: T0 + 2 * H },
      { type: "register", memberId: "quiet", handle: "c", at: T0 },
      { type: "join", memberId: "quiet", at: T0 + 1 * H },
      { type: "introduce", memberId: "quiet", at: T0 + 2 * H, text: "hi" },
      { type: "message", memberId: "quiet", at: T0 + 3 * H, channel: "g", text: "hey" },
      { type: "register", memberId: "nosub", handle: "d", at: T0 + 100 * H },
      { type: "join", memberId: "nosub", at: T0 + 101 * H },
      { type: "introduce", memberId: "nosub", at: T0 + 102 * H, text: "hi" },
      { type: "message", memberId: "nosub", at: now - 5 * H, channel: "g", text: "working on it" },
      { type: "register", memberId: "done", handle: "e", at: T0 },
      { type: "submit", memberId: "done", at: T0 + 10 * H },
    ]);

    const flags = scan(c, { now, deadlineAt: DEADLINE });
    const byKind = new Map(flags.map((f) => [f.memberId, f.kind]));
    expect(byKind.get("nojoin")).toBe("registered-no-join");
    expect(byKind.get("nointro")).toBe("joined-no-intro");
    expect(byKind.get("quiet")).toBe("gone-quiet");
    expect(byKind.get("nosub")).toBe("missing-submission");
    expect(byKind.has("done")).toBe(false);
  });

  it("prefers early-funnel nudges over missing-submission near the deadline", () => {
    const now = DEADLINE - 24 * H;
    const c = replay([{ type: "register", memberId: "u1", handle: "a", at: T0 }]);
    expect(scan(c, { now, deadlineAt: DEADLINE })[0]?.kind).toBe("registered-no-join");
  });

  it("does not flag missing submissions before the window opens", () => {
    const now = DEADLINE - 100 * H;
    const c = replay([
      { type: "register", memberId: "u1", handle: "a", at: T0 },
      { type: "join", memberId: "u1", at: T0 + 1 * H },
      { type: "introduce", memberId: "u1", at: T0 + 2 * H, text: "hi" },
      { type: "message", memberId: "u1", at: now - 1 * H, channel: "g", text: "active" },
    ]);
    expect(scan(c, { now, deadlineAt: DEADLINE })).toHaveLength(0);
  });
});

describe("approval gate", () => {
  const NOW = new Date("2026-09-13T06:00:00Z").getTime();

  function setup() {
    const sent: string[] = [];
    const audit = new AuditLog();
    const queue = new ApprovalQueue({
      send: (d) => void sent.push(d.text),
      audit,
      now: () => NOW,
    });
    return { sent, audit, queue };
  }

  it("sends nothing before approval, sends after", async () => {
    const { sent, queue } = setup();
    const draft = queue.submit({ memberId: "u1", handle: "ada", kind: "gone-quiet", text: "nudge" });
    expect(sent).toHaveLength(0);
    expect(queue.pending()).toHaveLength(1);
    await queue.approve(draft.id, "organizer");
    expect(sent).toEqual(["nudge"]);
    expect(queue.get(draft.id)?.status).toBe("sent");
    expect(queue.pending()).toHaveLength(0);
  });

  it("rejected drafts are never sent", async () => {
    const { sent, queue } = setup();
    const draft = queue.submit({ memberId: "u1", handle: "ada", kind: "gone-quiet", text: "nudge" });
    queue.reject(draft.id, "organizer", "too pushy");
    await expect(queue.approve(draft.id, "organizer")).rejects.toThrow(/rejected/);
    expect(sent).toHaveLength(0);
  });

  it("records the whole lifecycle in the audit log", async () => {
    const { audit, queue } = setup();
    const draft = queue.submit({ memberId: "u1", handle: "ada", kind: "gone-quiet", text: "nudge" });
    await queue.approve(draft.id, "organizer");
    const kinds = audit.list().map((e) => e.kind);
    expect(kinds).toEqual(["outreach.approved", "outreach.sent"]);
  });

  it("a failing sender lands in send_failed, and retry recovers it idempotently", async () => {
    let attempts = 0;
    const audit = new AuditLog();
    const queue = new ApprovalQueue({
      send: () => {
        attempts++;
        if (attempts === 1) throw new Error("discord 503");
      },
      audit,
      now: () => NOW,
    });
    const draft = queue.submit({ memberId: "u1", handle: "ada", kind: "gone-quiet", text: "nudge" });
    await queue.approve(draft.id, "organizer");
    expect(queue.get(draft.id)?.status).toBe("send_failed");
    expect(queue.get(draft.id)?.lastError).toMatch(/503/);

    await queue.retrySend(draft.id);
    expect(queue.get(draft.id)?.status).toBe("sent");
    expect(queue.get(draft.id)?.lastError).toBeUndefined();
    expect(attempts).toBe(2);
    const kinds = audit.list().map((e) => e.kind);
    expect(kinds).toEqual([
      "outreach.approved",
      "outreach.send_failed",
      "outreach.sent",
    ]);
  });

  it("refuses to retry a draft that is not stuck", async () => {
    const { queue } = setup();
    const draft = queue.submit({ memberId: "u1", handle: "ada", kind: "gone-quiet", text: "nudge" });
    await expect(queue.retrySend(draft.id)).rejects.toThrow(/pending/);
  });

  it("marks demo-sender outcomes as simulated — never as sent", async () => {
    const audit = new AuditLog();
    const queue = new ApprovalQueue({
      send: () => ({ simulated: true, reference: "sim:od-1" }),
      audit,
      now: () => NOW,
    });
    const draft = queue.submit({ memberId: "u1", handle: "ada", kind: "gone-quiet", text: "nudge" });
    await queue.approve(draft.id, "organizer");
    expect(queue.get(draft.id)?.status).toBe("simulated");
    expect(queue.get(draft.id)?.reference).toBe("sim:od-1");
    const kinds = audit.list().map((e) => e.kind);
    expect(kinds).toContain("outreach.simulated");
    expect(kinds).not.toContain("outreach.sent");
  });

  it("invokes the persist hook write-ahead and after the outcome", async () => {
    const snapshots: string[] = [];
    const queue = new ApprovalQueue({
      send: () => ({ simulated: false, reference: "msg-1" }),
      persist: () => snapshots.push("persist"),
      now: () => NOW,
    });
    const draft = queue.submit({ memberId: "u1", handle: "ada", kind: "gone-quiet", text: "nudge" });
    await queue.approve(draft.id, "organizer");
    expect(snapshots).toHaveLength(2); // before the send (approved) + after (sent)
    expect(queue.get(draft.id)?.reference).toBe("msg-1");
  });

  it("recoverUnknownDeliveries flags crash-window drafts instead of resending silently", () => {
    const restored = recoverUnknownDeliveries([
      {
        id: "od-1", memberId: "u1", handle: "ada", kind: "gone-quiet", text: "nudge",
        createdAt: NOW, status: "approved", decidedBy: "org", decidedAt: NOW,
      },
      {
        id: "od-2", memberId: "u2", handle: "bo", kind: "gone-quiet", text: "yo",
        createdAt: NOW, status: "sent", sentAt: NOW, reference: "msg-9",
      },
    ]);
    expect(restored[0]?.status).toBe("send_failed");
    expect(restored[0]?.lastError).toMatch(/outcome unknown/);
    expect(restored[1]?.status).toBe("sent");
  });

  it("drafts outreach for radar flags via the LLM, gated behind approval", async () => {
    const { sent, audit, queue } = setup();
    const c = replay([{ type: "register", memberId: "u1", handle: "ada", at: T0 }]);
    const flags = scan(c, { now: NOW, deadlineAt: DEADLINE });
    const ids = await draftOutreachForFlags(flags, new MockLlm(), queue, audit);
    expect(ids).toHaveLength(1);
    expect(sent).toHaveLength(0); // drafted, not sent
    expect(queue.pending()[0]?.text).toMatch(/ada/);
    expect(audit.list().some((e) => e.kind === "outreach.drafted")).toBe(true);
  });
});
