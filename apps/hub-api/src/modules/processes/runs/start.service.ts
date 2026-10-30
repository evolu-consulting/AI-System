// HUB-FR-105 · HUB-FR-113 · HUB-BR-27/28 · D1/D10/D14 · T1 · PF1 · bắt đầu run: phòng (`!key` timeline), Hỏi AI (202),
// nút "▶ Quy trình" / admin; chốt snapshot (BR-27), hội thoại nền (D1), ≤ 5 run/tenant (§4), thread `block` (T1); liệt kê.
// Khoá §10: rooms → advisory `process:<tenant>` → process_runs → … → tin gọi. Sau COMMIT: `kick` + `postThread`.
import type {
  ProcessCatalogItem,
  ProcessRunListQuery,
  ProcessRunSummary,
  SendRoomMessageRequest,
} from "@ai/contracts/chat";
import type { ProcessInputValue } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { publishUserEvents } from "../../../lib/user-stream";
import { lockFor } from "../../rooms/manage/rooms.service";
import {
  advanceRead,
  bumpSeq,
  fanout,
  findByClientId,
  type SendResult,
} from "../../rooms/messages/messages.service";
import { messageEvents } from "../../rooms/room-events";
import { toRoomMessage } from "../../rooms/rooms.map";
import { runTimesOf, withRunTimes } from "../adapters/runs/run-list.repo";
import type { Bang } from "../core/bang.rules";
import { processError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
import { enqueueThread } from "../core/thread";
import { canRun } from "../domain/runs/run-access.rules";
import * as repo from "./runs.repo";
import { type CreateRunInput, createRun, originOf } from "./start-inputs";

type StartBang = Extract<Bang, { kind: "process" | "invalid" }>;
type Me = { tenantId: string; userId: string };
const meOf = (u: AuthUser): Me => ({ tenantId: u.tenantId, userId: u.userId });
export type ProcessDepsCore = Omit<ProcessDeps, "start">;

export class StartService {
  constructor(private readonly d: ProcessDepsCore) {}

  /** CHAT-AC-51 · catalog người xem bắt đầu được (bật + run group). Lọc group trong bộ nhớ (≤ 200). */
  async catalog(u: AuthUser): Promise<ProcessCatalogItem[]> {
    const groups = (await this.d.config.user(u.userId))?.groupIds ?? new Set<string>();
    const rows = await this.#read(u, (tx) => repo.catalogDefs(tx, u.tenantId));
    return rows
      .filter((r) => r.run_group_ids.length === 0 || r.run_group_ids.some((g) => groups.has(g)))
      .map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        input_hint: r.input_hint,
        stage_count: r.stage_count,
        inputs: r.inputs ?? [],
      }));
  }

  /** `!key` timeline phòng (T1): tin gọi user + run + thread `block`; lỗi ⇒ ROLLBACK (không lưu tin). */
  async fromRoomMessage(
    u: AuthUser,
    roomId: string,
    body: SendRoomMessageRequest,
    bang: StartBang,
  ): Promise<SendResult> {
    const me = meOf(u);
    const userState = await this.d.config.user(u.userId);
    const { out, events, runId } = await withHubScope(this.d.db, { kind: "user", ...me }, (tx) =>
      this.#roomStartTx(tx, { me, u, roomId, body, bang, userState }),
    );
    await publishUserEvents(this.d.redis, events, this.d.log);
    if (runId) await this.#afterCommit(runId, true);
    return out;
  }

  /** Tx scope user người gửi (§10): trùng `client_msg_id` ⇒ tin cũ; else tạo run + tin gọi + khối thread. */
  async #roomStartTx(
    tx: Tx,
    c: {
      me: Me;
      u: AuthUser;
      roomId: string;
      body: SendRoomMessageRequest;
      bang: StartBang;
      userState: Awaited<ReturnType<ProcessDepsCore["config"]["user"]>>;
    },
  ): Promise<{ out: SendResult; events: ReturnType<typeof messageEvents>; runId: string | null }> {
    const { me, u, roomId, body, bang, userState } = c;
    await lockFor(tx, me, roomId, "send");
    const dup = await findByClientId(tx, me, roomId, body.client_msg_id);
    if (dup)
      return {
        out: {
          message: toRoomMessage(dup),
          created: false,
          ...(dup.processRunId && {
            process: { runId: dup.processRunId, flowId: dup.flowId as string },
          }),
        },
        events: [],
        runId: null,
      };
    const def = await this.#resolve(tx, u, userState, bang);
    const r = await this.#insert(tx, u, {
      def,
      input: bang.kind === "process" ? bang.input : "",
      origin: { originKind: "room", originRoomId: roomId, originConversationId: null },
    });
    return this.#writeCall(tx, { me, u, roomId, body }, def, r);
  }

  /** Tin gọi `!key` (user, `main`) + khối thread `block` + sự kiện phòng. */
  async #writeCall(
    tx: Tx,
    c: { me: Me; u: AuthUser; roomId: string; body: SendRoomMessageRequest },
    def: repo.StartDefRow,
    r: { runId: string; flowId: string },
  ): Promise<{ out: SendResult; events: ReturnType<typeof messageEvents>; runId: string }> {
    const { me, u, roomId, body } = c;
    const { seq, at } = await bumpSeq(tx, me, roomId);
    await advanceRead(tx, me, roomId, seq);
    const msg = await repo.insertCallMessage(tx, {
      tenantId: u.tenantId,
      userId: u.userId,
      roomId,
      seq,
      at,
      content: body.content,
      clientMsgId: body.client_msg_id,
      flowId: r.flowId,
      runId: r.runId,
    });
    await repo.setTrigger(tx, r.runId, msg.id);
    await this.#enqueueBlock(tx, r.runId, def);
    const message = toRoomMessage({
      id: msg.id,
      roomId: msg.room_id,
      seq: Number(msg.seq),
      senderType: "user",
      sender: { id: u.userId, displayName: msg.display_name, username: msg.username },
      content: msg.content,
      clientMsgId: msg.client_msg_id,
      createdAt: new Date(msg.created_at),
      flowId: msg.flow_id,
      placement: "main",
      processRunId: msg.process_run_id,
    });
    const fan = await fanout(tx, roomId);
    return {
      out: { message, created: true, process: { runId: r.runId, flowId: r.flowId } },
      events: messageEvents(roomId, message, fan),
      runId: r.runId,
    };
  }

  /** `POST /process-runs` (nút ▶ / origin none / conversation). */
  async createFromApi(
    u: AuthUser,
    req: {
      process_key: string;
      input: string;
      origin: {
        kind: "room" | "conversation" | "none";
        room_id?: string;
        conversation_id?: string;
      };
      inputs?: ProcessInputValue[];
    },
    /** N2-FR-01 · gói gắn run vào bản ghi trước rồi tự kick (`PackRuns.start`). */
    o: {
      deferKick?: boolean;
      /** contract-flow S1a · bản ghi gói của run — CHỈ `PackRunsPort.start` truyền (route công khai không). */
      packRef?: { pack: string; recordId: string };
    } = {},
  ): Promise<ProcessRunSummary> {
    const me = meOf(u);
    const userState = await this.d.config.user(u.userId);
    const { summary, runId, isRoom } = await withHubScope(
      this.d.db,
      { kind: "user", ...me },
      async (tx) => {
        const origin = await originOf(tx, u, req.origin);
        const def = await this.#resolve(tx, u, userState, {
          kind: "process",
          key: req.process_key,
          input: req.input,
        });
        // prod-fix · run gắn bản ghi gói (lượt duyệt HĐ chờ người nhiều ngày) không chịu/không tính trần run/tenant.
        const r = await this.#insert(
          tx,
          u,
          { def, input: req.input, origin, inputs: req.inputs },
          !!o.packRef,
        );
        if (o.packRef)
          await tx.execute(sql`update hub.process_runs set pack_key = ${o.packRef.pack},
            pack_record_id = ${o.packRef.recordId} where id = ${r.runId} and tenant_id = ${u.tenantId}`);
        if (origin.originKind === "room") await this.#enqueueBlock(tx, r.runId, def);
        const row = await repo.loadSummary(tx, u.tenantId, r.runId);
        return {
          summary: repo.toSummary(row as repo.RunSummaryRow),
          runId: r.runId,
          isRoom: origin.originKind === "room",
        };
      },
    );
    if (!o.deferKick) await this.#afterCommit(runId, isRoom);
    return summary;
  }

  /** D14 · Hỏi AI `!key` ⇒ 202 (origin conversation, không thread). */
  async fromConversation(
    u: AuthUser,
    conversationId: string,
    bang: StartBang,
  ): Promise<ProcessRunSummary> {
    const me = meOf(u);
    const userState = await this.d.config.user(u.userId);
    const { summary, runId } = await withHubScope(
      this.d.db,
      { kind: "user", ...me },
      async (tx) => {
        const def = await this.#resolve(tx, u, userState, bang);
        const r = await this.#insert(tx, u, {
          def,
          input: bang.kind === "process" ? bang.input : "",
          origin: {
            originKind: "conversation",
            originRoomId: null,
            originConversationId: conversationId,
          },
        });
        const row = await repo.loadSummary(tx, u.tenantId, r.runId);
        return { summary: repo.toSummary(row as repo.RunSummaryRow), runId: r.runId };
      },
    );
    await this.#afterCommit(runId, false);
    return summary;
  }

  /** ADM-FR-67 · nút "Chạy" admin (def đã qua kiểm ở `DefsService.run`): origin admin, started_by = admin. */
  async fromAdmin(
    u: AuthUser,
    defId: string,
    input: string,
    inputs?: ProcessInputValue[],
    test = false,
  ) {
    const me = meOf(u);
    const { summary, runId } = await withHubScope(
      this.d.db,
      { kind: "user", ...me },
      async (tx) => {
        const def = await repo.findDefById(tx, u.tenantId, defId);
        if (!def) throw processError("PROCESS_NOT_FOUND", { suggestions: [] });
        const r = await this.#insert(tx, u, {
          def,
          input,
          inputs,
          isTest: test || def.from_template, // CR-105 · cờ rõ từ Showcase, hoặc bản sao của mẫu
          origin: { originKind: "admin", originRoomId: null, originConversationId: null },
        });
        const row = await repo.loadSummary(tx, u.tenantId, r.runId);
        return { summary: repo.toSummary(row as repo.RunSummaryRow), runId: r.runId };
      },
    );
    await this.#afterCommit(runId, false);
    return summary;
  }

  /** ADM-FR-67 · `GET /process-runs`. platform_admin + `?tenant_id` ⇒ scope `user` của tenant đích (như detail;
   * RLS process_runs chỉ gác `tenant_id`), không phải tenant admin (D4). */
  async list(u: AuthUser, q: ProcessRunListQuery, tenantIdQ?: string) {
    const tenantId = this.#listTenant(u, q, tenantIdQ);
    const scope = { kind: "user" as const, userId: u.userId, tenantId };
    const [rows, times] = await withHubScope(this.d.db, scope, async (tx) => {
      if (q.room_id && !(await repo.isRoomMember(tx, tenantId, q.room_id, u.userId)))
        throw appError("NOT_FOUND");
      const rs = await repo.listRuns(tx, {
        tenantId,
        ...(q.scope === "mine" && { startedBy: u.userId }),
        ...(q.room_id && { roomId: q.room_id }),
        ...(q.conversation_id && { conversationId: q.conversation_id }),
        ...(q.process_key && { processKey: q.process_key }),
        ...(q.status && { status: q.status }),
        ...(q.include_test && { includeTest: true }),
        limit: q.limit,
        ...(q.cursor && { after: repo.decodeCursor(q.cursor) }),
      });
      // D2-45 · PD2-P05 · một câu theo tập cho cả trang (không câu theo run).
      const ids = rs.slice(0, q.limit).map((r) => r.id);
      return [rs, await runTimesOf(tx, tenantId, ids)] as const;
    });
    const page = rows.slice(0, q.limit);
    const last = rows.length > q.limit ? page[page.length - 1] : undefined;
    return {
      items: page.map((r) => withRunTimes(repo.toSummary(r), times)),
      next_cursor: last ? repo.encodeCursor([last.started_at, last.id]) : null,
    };
  }

  // ── nội bộ ──
  #read<T>(u: AuthUser, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.d.db, { kind: "user", ...meOf(u) }, fn);
  }

  #listTenant(u: AuthUser, q: ProcessRunListQuery, tenantIdQ?: string): string {
    if (q.scope !== "tenant") return u.tenantId;
    if (u.role !== "tenant_admin" && u.role !== "platform_admin") throw appError("FORBIDDEN");
    return u.role === "platform_admin" && tenantIdQ ? tenantIdQ : u.tenantId;
  }

  async #resolve(
    tx: Tx,
    u: AuthUser,
    userState: { active: boolean; groupIds: ReadonlySet<string> } | undefined,
    bang: StartBang,
  ): Promise<repo.StartDefRow> {
    const us = {
      active: userState?.active ?? false,
      groupIds: userState?.groupIds ?? new Set<string>(),
    };
    if (bang.kind === "process") {
      const row = await repo.findDefByKey(tx, u.tenantId, bang.key);
      if (
        row &&
        canRun(us, { enabled: row.enabled, deleted: row.deleted, runGroupIds: row.run_group_ids })
      )
        return row;
    }
    const token = bang.kind === "process" ? bang.key : bang.token;
    const rows = await repo.catalogDefs(tx, u.tenantId);
    const { groupIds } = us;
    const keys = rows
      .filter((r) => r.run_group_ids.length === 0 || r.run_group_ids.some((g) => groupIds.has(g)))
      .map((r) => r.key);
    const near = repo.suggestProcesses(token, keys); // E-P2 · key sai hẳn ⇒ dự phòng top-3 catalog
    throw processError("PROCESS_NOT_FOUND", { suggestions: near.length ? near : keys.slice(0, 3) });
  }

  #insert(
    tx: Tx,
    u: AuthUser,
    p: CreateRunInput,
    packBound = false,
  ): Promise<{ runId: string; flowId: string }> {
    const cfg = { runsPerTenant: this.d.runsPerTenant, now: this.d.now, kh: this.d.kh, packBound };
    return createRun(tx, u, p, cfg);
  }

  async #enqueueBlock(tx: Tx, runId: string, def: repo.StartDefRow): Promise<void> {
    await enqueueThread(tx, {
      runId,
      roomId: "",
      kind: "block",
      process_run_id: runId,
      process: { key: def.key, name: def.name },
      stage_count: def.stages.length,
    });
  }

  async #afterCommit(runId: string | null, isRoom: boolean): Promise<void> {
    if (!runId) return;
    try {
      await this.d.launcher.kick(runId);
    } catch {
      this.d.log.warn("process-kick-failed", { run_id: runId });
    }
    if (isRoom)
      try {
        await this.d.postThread(runId);
      } catch {
        // poster vòng 5 s nhặt lại
      }
  }
}
