export interface AuditEvent {
  ts: string;
  kind:
    | "faq.answered"
    | "faq.escalated"
    | "contradiction.found"
    | "outreach.drafted"
    | "outreach.approved"
    | "outreach.sent"
    | "outreach.rejected";
  summary: string;
  detail?: unknown;
}

/** Append-only trail. Every copilot action — or refusal — is recorded. */
export class AuditLog {
  private events: AuditEvent[] = [];

  record(kind: AuditEvent["kind"], summary: string, detail?: unknown): AuditEvent {
    const event: AuditEvent = { ts: new Date().toISOString(), kind, summary, detail };
    this.events.push(event);
    return event;
  }

  list(): readonly AuditEvent[] {
    return this.events;
  }

  toJSONL(): string {
    return this.events.map((e) => JSON.stringify(e)).join("\n");
  }
}
