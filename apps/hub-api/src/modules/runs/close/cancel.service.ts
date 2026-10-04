// HUB-FR-43 · H1-R14 · P12 · huỷ run (plan H1 §5.7): E15 `POST /runs/:id/cancel` và phần huỷ run của E9.
// Ghi DB theo §3.5 rồi (sau COMMIT) dừng writer cục bộ nếu có và phát `run.failed CANCELLED` bằng "XADD bên ngoài"
// (§5.2) — chủ ở instance khác bị chặn bởi id `sse:<id>` và mất lease (B10). Không biết HTTP.
import type { Run } from "@ai/contracts/chat";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { Db } from "../../../lib/db";
import { appError, safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import type { Redis } from "../../../lib/redis";
import type { ConversationService } from "../../conversations/conversations.service";
import { runErrorText } from "../run-errors";
import * as repo from "../runs.repo";
import { lastEventIdOf, toRun } from "../runs.service";
import { appendExternal, parseEntry, type RunRegistry, sseKey } from "../sse/sse-writer";
import {
  type CancelTarget,
  type CancelWrite,
  cancelRun,
  runningRunsOf,
  setFinalSeq,
} from "./cancel.repo";

export type CancelServiceDeps = {
  db: Db;
  redis: Redis;
  /** = `HUB_INSTANCE_ID`: instance huỷ chiếm `runs.owner` (P12). */
  owner: string;
  /** Bảng writer của instance này (`RunService.registry`). */
  registry: RunRegistry;
  conversations: ConversationService;
  log: Logger;
};

export type Cancelled = { target: CancelTarget; error: CancelWrite["error"] };

const cancelError = (locale: repo.Locale): CancelWrite["error"] => ({
  code: "CANCELLED",
  ...runErrorText("CANCELLED", locale),
});

/** Nối `delta` đã phát trong `sse:<id>` (C1: tin assistant = nối các delta, kể cả run bị huỷ). Chỉ đọc. */
export async function deltaContent(redis: Redis, runId: string): Promise<string> {
  const rows = (await redis.call("XRANGE", sseKey(runId), "-", "+")) as [string, string[]][] | null;
  let out = "";
  for (const [, fields] of rows ?? []) {
    const ev = parseEntry(fields);
    const text = ev?.event === "delta" ? (ev.data as { text?: unknown }).text : undefined;
    if (typeof text === "string") out += text;
  }
  return out;
}

export class CancelService {
  constructor(private readonly d: CancelServiceDeps) {}

  async #write(
    target: CancelTarget,
    locale: repo.Locale,
    run: (w: CancelWrite) => Promise<boolean>,
  ) {
    const error = cancelError(locale);
    const content = await deltaContent(this.d.redis, target.runId);
    return (await run({ target, owner: this.d.owner, error, content })) ? { target, error } : null;
  }

  /**
   * E15 · 404 khi không phải run của user. Trả ảnh chụp lúc nhận (C1 E15); run đã kết thúc → không đổi gì.
   * Đang chạy → transaction `system` §5.7; 0 dòng (vừa kết thúc ở chủ) → không phát gì.
   */
  async cancel(u: AuthUser, runId: string): Promise<Run> {
    const o = { tenantId: u.tenantId, userId: u.userId };
    const r = await withHubScope(this.d.db, { kind: "user", ...o }, (tx) =>
      repo.findRun(tx, o, runId),
    );
    if (!r) throw appError("NOT_FOUND");
    const snapshot = toRun(r, await lastEventIdOf(this.d.redis, r));
    if (r.status !== "running") return snapshot;
    const target: CancelTarget = { runId: r.id, ...r };
    const done = await this.#write(target, r.locale, (w) =>
      withHubScope(this.d.db, { kind: "system" }, (tx) => cancelRun(tx, w)),
    );
    if (done) await this.#announce(done);
    return snapshot;
  }

  /** E9 · một transaction `user`: xoá mềm hội thoại (khoá đầu tiên) rồi huỷ từng run `running` của nó. 404 như B5. */
  async removeConversation(u: AuthUser, conversationId: string): Promise<void> {
    const done = await this.d.conversations.remove(u, conversationId, async (tx, o) => {
      const out: Cancelled[] = [];
      for (const r of await runningRunsOf(tx, o, conversationId)) {
        const c = await this.#write(r, r.locale, (w) => cancelRun(tx, w));
        if (c) out.push(c);
      }
      return out;
    });
    for (const c of done ?? []) await this.#announce(c);
  }

  #announce(c: Cancelled): Promise<void> {
    return announceClosed(this.d, c);
  }
}

/**
 * Sau COMMIT đóng run (huỷ §5.7, sweeper §5.8): dừng writer cục bộ (finish của nó sẽ 0 dòng) rồi "XADD bên ngoài"
 * `run.failed`. Lỗi Redis → log, E13 dựng lại từ DB.
 */
export async function announceClosed(
  d: Pick<CancelServiceDeps, "db" | "redis" | "registry" | "log">,
  { target: t, error }: Cancelled,
): Promise<void> {
  d.registry.get(t.runId)?.abort();
  const ev = {
    event: "run.failed" as const,
    data: { run_id: t.runId, message_id: t.answerMessageId, ...error },
  };
  try {
    const seq = await appendExternal(d.redis, t.runId, ev, { log: d.log });
    if (seq === null) return;
    await withHubScope(d.db, { kind: "system" }, (tx) => setFinalSeq(tx, t.runId, seq));
  } catch (err) {
    d.log.error("run-close-publish-failed", { run_id: t.runId, ...safeErrorFields(err) });
  }
}
