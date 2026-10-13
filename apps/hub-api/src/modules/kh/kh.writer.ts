// HUB-FR-133 · HUB-FR-134 · K1-AC05 · K1-AC06 · Q32 · Q34 · CR-073 · plan K1 §3.5 "Gửi", §4 (audit `write_fail`), §11 G2 ·
// bộ gửi nền `kh_writes` (nhịp 10 s; seam `ProcessHandles.khWriteOnce`): lấy lô tới hạn (tx ngắn scope system) ⇒ mỗi hàng
// đọc lại kết nối (PK; mất / không dùng được ⇒ `skipped` + audit `disabled`) ⇒ `POST /vector/add` (id cố định ⇒ ghi lại =
// ghi đè) ⇒ `done` | mạng/timeout/429/5xx ∧ < 5 lần ⇒ hẹn lại `now() + 30 s × 2^(n−1)` | còn lại `failed` + audit.
// Không đổi trạng thái run/gate. Khoá chỉ đọc trong `KhClient`; log chỉ `{connection_id, code, http_status}`.
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import { dbHubAudit, type HubAuditWriter } from "../../lib/hub-audit";
import type { Logger } from "../../lib/logger";
import { startLoop } from "../../lib/loop";
import { isKhCallError, type KhCallError } from "./kh.client";
import type { KhRuntime } from "./kh.mount";
import { readConn } from "./kh.repo";
import { type KhFailure, khUsableNow, khWriteRetryable, writeBackoffMs } from "./kh.rules";
import { khWorklogBody } from "./kh.summary.rules";
import { claimDue, type DueWrite, saveResult, type WriteResult } from "./kh.writes.repo";

export const KH_WRITE_EVERY_MS = 10_000;
export const KH_WRITE_BATCH = 20;
export const KH_WRITE_LEASE_S = 60;
export const KH_WRITE_ATTEMPTS_MAX = 5;

export type KhWriterDeps = {
  db: Db;
  rt: KhRuntime;
  log: Logger;
  audit?: HubAuditWriter;
};

/** `KhCallError` ⇒ đầu vào `khWriteRetryable` (null = không thử lại: `disabled`/`invalid`/4xx không mã…). */
function failureOf(e: KhCallError): KhFailure | null {
  if (e.status !== undefined) return e.status;
  if (e.code === "timeout") return "timeout";
  if (e.code === "unreachable") return "network";
  return null;
}

/** Kết quả một lần gửi lỗi (thuần). */
export function khWriteFailure(e: KhCallError, attempts: number): WriteResult {
  const n = attempts + 1;
  if (e.code === "disabled") return { status: "skipped", attempts, code: "disabled" };
  const f = failureOf(e);
  if (f !== null && khWriteRetryable(f) && n < KH_WRITE_ATTEMPTS_MAX)
    return { status: "pending", attempts: n, code: e.code, backoffMs: writeBackoffMs(n) };
  return { status: "failed", attempts: n, code: e.code };
}

export class KhWriter {
  readonly #audit: HubAuditWriter;
  constructor(private readonly d: KhWriterDeps) {
    this.#audit = d.audit ?? dbHubAudit;
  }

  /** Một lô (seam G2): trả số hàng đã xử lý (done/failed/skipped/hẹn lại). */
  async writeOnce(): Promise<number> {
    const due = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      claimDue(tx, KH_WRITE_BATCH, KH_WRITE_LEASE_S),
    );
    for (const w of due) await this.#one(w);
    return due.length;
  }

  start(signal?: AbortSignal): void {
    startLoop({
      name: "kh-writer",
      everyMs: KH_WRITE_EVERY_MS,
      tick: () => this.writeOnce(),
      log: this.d.log,
      signal,
    });
  }

  async #one(w: DueWrite): Promise<void> {
    let r: WriteResult;
    try {
      r = await this.#send(w);
    } catch (err) {
      if (!isKhCallError(err)) {
        this.d.log.warn("kh-write-error", {
          connection_id: w.connection_id,
          ...safeErrorFields(err),
        });
        return; // lỗi lạ (DB…) ⇒ để hàng tới hạn lại sau lease
      }
      r = khWriteFailure(err, w.attempts);
      const http = err.status === undefined ? {} : { http_status: err.status };
      this.d.log.warn("kh-write-failed", {
        connection_id: w.connection_id,
        code: err.code,
        ...http,
      });
    }
    await this.#save(w, r);
  }

  async #send(w: DueWrite): Promise<WriteResult> {
    const conn = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      readConn(tx, w.connection_id),
    );
    const env = { dev: this.d.rt.dev };
    if (!conn || !khUsableNow(conn, this.d.rt.cfg.allowedOrigins, env))
      return { status: "skipped", attempts: w.attempts, code: "disabled" };
    const body = khWorklogBody({
      id: w.vector_id,
      project: w.project_id,
      subject: w.subject,
      text: w.body,
      ts: new Date().toISOString(),
    });
    const kc = {
      id: conn.id,
      baseUrl: conn.baseUrl,
      secretId: conn.secretId,
      version: conn.version,
    };
    await this.d.rt.client.add(kc, body);
    return { status: "done" };
  }

  /** Kết quả + audit `write_fail` (failed/skipped) cùng tx; lỗi ghi ⇒ warn (hàng tới hạn lại sau lease). */
  async #save(w: DueWrite, r: WriteResult): Promise<void> {
    try {
      await withHubScope(this.d.db, { kind: "system" }, async (tx) => {
        await saveResult(tx, w.id, r);
        if (r.status !== "failed" && r.status !== "skipped") return;
        await this.#audit.insert(tx, {
          tenantId: w.tenant_id,
          actorId: null,
          actorUsername: null,
          actorRole: null,
          action: "write_fail",
          entity: "kh_worklog",
          entityId: w.process_run_id,
          entityName: w.subject,
          hubConfigVersion: null,
          before: null,
          after: null,
          summary: { code: r.code, attempts: r.attempts, stage_run_id: w.stage_run_id },
        });
      });
    } catch (err) {
      this.d.log.warn("kh-write-save-failed", { kh_write_id: w.id, ...safeErrorFields(err) });
    }
  }
}
