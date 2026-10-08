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
import { lastEventIdOf, toRun } from "../run-view";
import * as repo from "../runs.repo";
import {
  appendExternal,
  notifyClosed,
  parseEntry,
  type RunRegistry,
  sseKey,
} from "../sse/sse-writer";
import {
  type CancelTarget,
  type CancelWrite,
  cancelRun,
  type RoomRunsScope,
  runningRoomRuns,
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
  /** X2b · gọi sau COMMIT huỷ (E15, E9) + phát `run.failed`; sweeper/lease không gọi (để `reconcile`). */
  onClosed?: (runId: string) => void;
};

export type Cancelled = { target: CancelTarget; error: CancelWrite["error"] };

/** Trần run huỷ một lần (≤ 50 thành viên × `max_concurrent_runs`); dư ⇒ chạy hết tự nhiên, definer vẫn không đăng (R17). */
const ROOM_CANCEL_MAX = 500;

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

  /** `content` đọc từ Redis **trước** transaction (không giữ khoá DB trong lúc gọi Redis). */
  async #write(
    w: { target: CancelTarget; locale: repo.Locale; content: string },
    run: (w: CancelWrite) => Promise<boolean>,
  ): Promise<Cancelled | null> {
    const { target } = w;
    const error = cancelError(w.locale);
    const ok = await run({ target, owner: this.d.owner, error, content: w.content });
    return ok ? { target, error } : null;
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
    const content = await deltaContent(this.d.redis, r.id);
    const done = await this.#write({ target, locale: r.locale, content }, (w) =>
      withHubScope(this.d.db, { kind: "system" }, (tx) => cancelRun(tx, w)),
    );
    if (done) await this.#announce(done);
    return snapshot;
  }

  /**
   * X2b R17 · Q8 · sau COMMIT rời / bớt / xoá phòng: huỷ từng run `running` của phòng (của `userId` nếu có) như E15
   * (transaction `system` mỗi run) ⇒ `onClosed` ⇒ definer đăng tin thấy không còn thành viên ⇒ `skipped` +
   * `room.run_finished {cancelled, message_id:null}`. Kết quả trễ của runtime bị bỏ (run không còn `running`).
   */
  async cancelRoomRuns(p: RoomRunsScope): Promise<number> {
    const targets = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      runningRoomRuns(tx, p, ROOM_CANCEL_MAX),
    );
    let n = 0;
    for (const t of targets) {
      const content = await deltaContent(this.d.redis, t.runId);
      const done = await this.#write({ target: t, locale: t.locale, content }, (w) =>
        withHubScope(this.d.db, { kind: "system" }, (tx) => cancelRun(tx, w)),
      );
      if (!done) continue;
      await this.#announce(done);
      n++;
    }
    return n;
  }

  /** E9 · một transaction `user`: xoá mềm hội thoại (khoá đầu tiên) rồi huỷ từng run `running` của nó. 404 như B5. */
  async removeConversation(u: AuthUser, conversationId: string): Promise<void> {
    const contents = await this.#deltasOf(u, conversationId);
    const done = await this.d.conversations.remove(u, conversationId, async (tx, o) => {
      const out: Cancelled[] = [];
      for (const r of await runningRunsOf(tx, o, conversationId)) {
        const w = { target: r, locale: r.locale, content: contents.get(r.runId) ?? "" };
        const c = await this.#write(w, (cw) => cancelRun(tx, cw));
        if (c) out.push(c);
      }
      return out;
    });
    for (const c of done ?? []) await this.#announce(c);
  }

  /** Nội dung `delta` của các run đang chạy (đọc không khoá, trước transaction E9). Run mới xen giữa → "". */
  async #deltasOf(u: AuthUser, conversationId: string): Promise<Map<string, string>> {
    const o = { tenantId: u.tenantId, userId: u.userId };
    const runs = await withHubScope(this.d.db, { kind: "user", ...o }, (tx) =>
      runningRunsOf(tx, o, conversationId),
    );
    const out = new Map<string, string>();
    for (const r of runs) out.set(r.runId, await deltaContent(this.d.redis, r.runId));
    return out;
  }

  async #announce(c: Cancelled): Promise<void> {
    await announceClosed(this.d, c);
    notifyClosed(this.d, c.target.runId);
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
