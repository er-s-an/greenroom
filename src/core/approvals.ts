import type { StallKind } from "./types.js";
import type { AuditLog } from "./audit.js";

export type DraftStatus = "pending" | "approved" | "rejected" | "send_failed" | "simulated" | "sent";

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
  /** Sender receipt (e.g. Discord message id); "sim:*" marks the demo sender. */
  reference?: string;
  /** Why the last send attempt failed; cleared on a successful resend. */
  lastError?: string;
}

export interface SendOutcome {
  /** True when the sender is a demo stub — nothing actually left the machine. */
  simulated: boolean;
  reference?: string;
}

/**
 * Restart recovery for the crash window between a real send and its snapshot.
 * A draft restored as `approved` (decided, but no sent/simulated/failed
 * outcome on disk) may or may not have been delivered — mark it send_failed
 * with an explicit warning instead of risking a silent duplicate resend.
 */
export function recoverUnknownDeliveries(drafts: OutreachDraft[]): OutreachDraft[] {
  return drafts.map((d) =>
    d.status === "approved"
      ? {
          ...d,
          status: "send_failed" as const,
          lastError:
            "restart interrupted the send; delivery outcome unknown — verify with the participant before retrying",
        }
      : d,
  );
}

/**
 * The approval gate. Every outbound message the copilot drafts sits here until
 * a human organizer approves or rejects it. The send function is injected, so
 * tests can prove nothing leaves without approval. A known failed send lands
 * in `send_failed` and can be retried after an operator verifies provider state.
 * This queue does not provide a provider idempotency key or exactly-once delivery.
 * The optional `persist` hook is called write-ahead (before the send, while
 * the draft is still `approved`) and after the outcome is recorded, narrowing
 * the crash window to a recoverable, loudly-marked state.
 */
export class ApprovalQueue {
  private drafts = new Map<string, OutreachDraft>();
  private counter = 0;

  constructor(
    private deps: {
      send: (draft: OutreachDraft) => SendOutcome | void | Promise<SendOutcome | void>;
      audit?: AuditLog;
      now?: () => number;
      /** Write-ahead snapshot hook — invoked before and after every send. */
      persist?: () => void;
    },
    initial: OutreachDraft[] = [],
  ) {
    for (const d of initial) {
      this.drafts.set(d.id, d);
      const n = Number(d.id.replace(/^od-/, ""));
      if (Number.isFinite(n)) this.counter = Math.max(this.counter, n);
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  all(): OutreachDraft[] {
    return [...this.drafts.values()];
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

  /** Approves and immediately attempts the send. Send failure → `send_failed`. */
  async approve(id: string, by: string): Promise<OutreachDraft> {
    const draft = this.mustGet(id);
    if (draft.status !== "pending") throw new Error(`draft ${id} is ${draft.status}, not pending`);
    draft.status = "approved";
    draft.decidedBy = by;
    draft.decidedAt = this.now();
    this.deps.audit?.record("outreach.approved", `draft ${id} approved by ${by}`, { draftId: id, by });
    await this.attemptSend(draft);
    return draft;
  }

  /** Operator-triggered retry for drafts stuck in `approved`/`send_failed`. */
  async retrySend(id: string): Promise<OutreachDraft> {
    const draft = this.mustGet(id);
    if (draft.status !== "approved" && draft.status !== "send_failed") {
      throw new Error(`draft ${id} is ${draft.status}; only approved/send_failed can be retried`);
    }
    await this.attemptSend(draft);
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

  private async attemptSend(draft: OutreachDraft): Promise<void> {
    // Write-ahead: persist the decided-but-unsent state before touching the
    // network. A crash after the real send and before the next snapshot
    // restores `approved`, which recoverUnknownDeliveries() flags loudly.
    this.deps.persist?.();
    try {
      const outcome = (await this.deps.send(draft)) ?? { simulated: false };
      draft.status = outcome.simulated ? "simulated" : "sent";
      draft.sentAt = this.now();
      draft.reference = outcome.reference;
      delete draft.lastError;
      this.deps.audit?.record(
        outcome.simulated ? "outreach.simulated" : "outreach.sent",
        outcome.simulated
          ? `draft ${draft.id} to ${draft.handle} handed to the demo sender (nothing left this machine)`
          : `draft ${draft.id} sent to ${draft.handle}`,
        { draftId: draft.id, reference: outcome.reference },
      );
    } catch (err) {
      draft.status = "send_failed";
      draft.lastError = err instanceof Error ? err.message : String(err);
      this.deps.audit?.record(
        "outreach.send_failed",
        `draft ${draft.id} approved but send failed: ${draft.lastError}`,
        { draftId: draft.id, error: draft.lastError },
      );
    }
    this.deps.persist?.();
  }

  private mustGet(id: string): OutreachDraft {
    const draft = this.drafts.get(id);
    if (!draft) throw new Error(`unknown draft id: ${id}`);
    return draft;
  }
}
