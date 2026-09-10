import type { StallKind } from "./types.js";
import type { AuditLog } from "./audit.js";

export type DraftStatus = "pending" | "approved" | "rejected" | "sent";

export interface OutreachDraft {
  id: string;
  memberId: string;
  handle: string;
  kind: StallKind;
  text: string;
  createdAt: number;
  status: DraftStatus;
  decidedBy?: string;
  decidedAt?: number;
  sentAt?: number;
}

/**
 * The approval gate. Every outbound message the copilot drafts sits here until
 * a human organizer approves or rejects it. The send function is injected, so
 * tests can prove nothing leaves without approval.
 */
export class ApprovalQueue {
  private drafts = new Map<string, OutreachDraft>();
  private counter = 0;

  constructor(
    private deps: {
      send: (draft: OutreachDraft) => void | Promise<void>;
      audit?: AuditLog;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  submit(input: { memberId: string; handle: string; kind: StallKind; text: string }): OutreachDraft {
    const draft: OutreachDraft = {
      ...input,
      id: `od-${++this.counter}`,
      createdAt: this.now(),
      status: "pending",
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  get(id: string): OutreachDraft | undefined {
    return this.drafts.get(id);
  }

  pending(): OutreachDraft[] {
    return [...this.drafts.values()].filter((d) => d.status === "pending");
  }

  async approve(id: string, by: string): Promise<OutreachDraft> {
    const draft = this.mustGet(id);
    if (draft.status !== "pending") throw new Error(`draft ${id} is ${draft.status}, not pending`);
    draft.status = "approved";
    draft.decidedBy = by;
    draft.decidedAt = this.now();
    this.deps.audit?.record("outreach.approved", `draft ${id} approved by ${by}`, { draftId: id, by });
    await this.deps.send(draft);
    draft.status = "sent";
    draft.sentAt = this.now();
    this.deps.audit?.record("outreach.sent", `draft ${id} sent to ${draft.handle}`, { draftId: id });
    return draft;
  }

  reject(id: string, by: string, reason?: string): OutreachDraft {
    const draft = this.mustGet(id);
    if (draft.status !== "pending") throw new Error(`draft ${id} is ${draft.status}, not pending`);
    draft.status = "rejected";
    draft.decidedBy = by;
    draft.decidedAt = this.now();
    this.deps.audit?.record("outreach.rejected", `draft ${id} rejected by ${by}${reason ? `: ${reason}` : ""}`, {
      draftId: id,
      by,
      reason,
    });
    return draft;
  }

  private mustGet(id: string): OutreachDraft {
    const draft = this.drafts.get(id);
    if (!draft) throw new Error(`unknown draft id: ${id}`);
    return draft;
  }
}
