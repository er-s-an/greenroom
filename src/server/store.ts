import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RadarEvent } from "../core/radar.js";
import type { AuditEvent } from "../core/audit.js";
import type { OutreachDraft } from "../core/approvals.js";

/**
 * File-backed persistence so the server survives restarts:
 * - community events append to events.jsonl (event-sourced; replayed on boot)
 * - audit events append to audit.jsonl
 * - approvals snapshot to approvals.json on every mutation
 * JSON/JSONL instead of a database so judges can read the state files directly.
 */
export class FileStore {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(name: string): string {
    return join(this.dir, name);
  }

  private readJsonl<T>(name: string): T[] {
    const p = this.path(name);
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  }

  appendEvent(event: RadarEvent): void {
    appendFileSync(this.path("events.jsonl"), JSON.stringify(event) + "\n");
  }

  loadEvents(): RadarEvent[] {
    return this.readJsonl<RadarEvent>("events.jsonl");
  }

  appendAudit(event: AuditEvent): void {
    appendFileSync(this.path("audit.jsonl"), JSON.stringify(event) + "\n");
  }

  loadAudit(): AuditEvent[] {
    return this.readJsonl<AuditEvent>("audit.jsonl");
  }

  saveApprovals(drafts: OutreachDraft[]): void {
    // atomic: tmp + rename, so a crash mid-write never leaves a torn snapshot
    const p = this.path("approvals.json");
    writeFileSync(p + ".tmp", JSON.stringify(drafts, null, 2));
    renameSync(p + ".tmp", p);
  }

  loadApprovals(): OutreachDraft[] {
    const p = this.path("approvals.json");
    if (!existsSync(p)) return [];
    return JSON.parse(readFileSync(p, "utf8")) as OutreachDraft[];
  }
}
