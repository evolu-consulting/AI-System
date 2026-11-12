// HD7-FR-03…10 · HD7-NFR-01 · D7-05 · D7-06: route sổ thanh toán dưới `/pack/contracts`. Guard quyền gói TRƯỚC đọc thân/tham số
// (viewer ghi ⇒ 403, 0 SQL); `:id` sai dạng ⇒ 400; tenant/người làm chỉ từ token; thân strict. `LedgerFail` ⇒ mã `LEDGER_ERRORS`;
// tenant khác ⇒ 404 như không có. Chỉnh tay điểm cần quyền `admin` (mgmt `owner`).
import {
  FULFILL_ERRORS,
  FulfillRequestSchema,
  LEDGER_ERRORS,
  type LedgerErrorCode,
  ObligationsQuerySchema,
  PartnerEventCreateSchema,
  PartnerEventsQuerySchema,
  PaymentsQuerySchema,
  PostponeEvidenceSchema,
  PostponeRequestSchema,
  RemindRequestSchema,
  ScheduleRequestSchema,
  SettleRequestSchema,
  VoidRequestSchema,
} from "@ai/contracts/pack-contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import {
  checkPackAccess,
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
  packGuard,
} from "../../kit/public";
import { DeliveryFail } from "../application/delivery.ports";
import type { ExecCommands } from "../application/exec-request.usecase";
import { LedgerFail } from "../application/ledger.ports";
import type { LedgerCommands, LedgerReads } from "../application/ledger.usecase";
import type { RepEngine } from "../domain/rep-current.rules";
import { deliveryError } from "./delivery.routes";
import { execError, execWho } from "./exec-errors";

const KEY = "contracts";
/** CR-127 X1 · tasks §9: câu VI của đường ghi thực hiện. */
function fulfillError(e: LedgerFail, byName: string | null = null): never {
  if (e.kind === "on_hold") {
    const h = e.detail;
    throw new AppError(
      "CONTRACT_ON_HOLD",
      FULFILL_ERRORS.CONTRACT_ON_HOLD,
      `Đang tạm khoá${h?.reason ? `: ${h.reason}` : ""} — chỉ ghi được tiền thu.`,
      { by: h?.by ?? null, reason: h?.reason ?? null },
    );
  }
  if (e.kind === "task_claimed")
    throw new AppError(
      "TASK_CLAIMED",
      FULFILL_ERRORS.TASK_CLAIMED,
      byName
        ? `Mốc đang do ${byName} xử lý — nhờ họ xác nhận.`
        : "Mốc đang do người khác xử lý — nhờ họ xác nhận.",
      { by: e.detail?.by ?? null, by_name: byName },
    );
  if (e.kind === "task_not_claimed")
    throw new AppError(
      "TASK_NOT_CLAIMED",
      FULFILL_ERRORS.TASK_NOT_CLAIMED,
      "Bấm Nhận việc trước khi xác nhận mốc.",
    );
  if (e.kind === "over_plan")
    throw new AppError(
      "OVER_PLAN",
      FULFILL_ERRORS.OVER_PLAN,
      "Vượt phần còn lại của mốc. Giảm số hoặc chọn mốc khác.",
    );
  throw new AppError(
    "CHANGE_PENDING",
    FULFILL_ERRORS.CHANGE_PENDING,
    "Mốc đang có yêu cầu thay đổi chờ duyệt.",
  );
}
const FULFILL_KINDS: readonly LedgerFail["kind"][] = [
  "on_hold",
  "over_plan",
  "change_pending",
  "task_claimed",
  "task_not_claimed",
];

const FAIL: Record<
  Exclude<
    LedgerFail["kind"],
    "locked" | "on_hold" | "over_plan" | "change_pending" | "task_claimed" | "task_not_claimed"
  >,
  LedgerErrorCode | "NOT_FOUND" | "FORBIDDEN" | "FLAG_ADMIN"
> = {
  not_found: "NOT_FOUND",
  done: "OBLIGATION_DONE",
  postpone_date: "POSTPONE_DATE",
  system: "EVENT_SYSTEM",
  event_type: "EVENT_TYPE",
  adjust: "ADJUST_INVALID",
  forbidden: "FORBIDDEN",
  severe_reason: "SEVERE_REASON",
  flag_admin: "FLAG_ADMIN",
};
const MESSAGES: Record<LedgerErrorCode, string> = {
  OBLIGATION_DONE: "Đợt này đã xong",
  POSTPONE_DATE: "Ngày hẹn mới phải sau hạn hiện tại",
  EVENT_SYSTEM:
    "Dòng do hệ thống tự ghi không huỷ được; trả rồi thì ghi Đã thu/Đã trả với đúng ngày",
  EVENT_TYPE: "Loại sự kiện không ghi tay được",
  ADJUST_INVALID: "Chỉnh tay từ -10 đến +10 điểm và phải ghi lý do",
  SEVERE_REASON: "Cờ đỏ (không giao, gian lận) phải ghi lý do",
};

export function ledgerError(e: unknown): never {
  if (e instanceof DeliveryFail) deliveryError(e);
  execError(e); // CR-127 X3: ExecFail ⇒ mã EXEC_ERRORS
  if (!(e instanceof LedgerFail)) throw e;
  if (e.kind === "locked") deliveryError(new DeliveryFail("locked"));
  if (FULFILL_KINDS.includes(e.kind)) fulfillError(e);
  const code = FAIL[e.kind as keyof typeof FAIL];
  if (code === "NOT_FOUND") throw appError("NOT_FOUND");
  if (code === "FLAG_ADMIN") throw new AppError("PACK_FORBIDDEN", 403, "Chỉ quản lý được gỡ cờ đỏ");
  if (code === "FORBIDDEN")
    throw new AppError("PACK_FORBIDDEN", 403, "Chỉ quản lý được chỉnh tay điểm");
  throw new AppError(code, LEDGER_ERRORS[code], MESSAGES[code]);
}
const run = <T>(p: Promise<T>): Promise<T> => p.catch(ledgerError);
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const uuid = (v: string | undefined) => parseWith(z.uuid(), v);
const eventId = (v: string | undefined) => parseWith(z.string().regex(/^[1-9][0-9]{0,17}$/), v);
/** Thân JSON (rỗng ⇒ {} như mgmt `body: X | None = None`; JSON hỏng ⇒ 400). */
const body = async <S extends z.ZodType>(c: Context, s: S): Promise<z.output<S>> =>
  parseWith(s, await readJson(c));

/** Tên hiển thị thành viên công ty (`id → tên`) — MỘT lần tra cho cả danh sách (không N+1). */
export type MemberNames = (who: {
  tenantId: string;
  userId: string;
}) => Promise<Map<string, string>>;

export function ledgerRoutes(
  view: PackAccessView,
  d: {
    cmd: LedgerCommands;
    reads: LedgerReads;
    engine?: () => RepEngine;
    exec?: ExecCommands;
    names?: MemberNames;
  },
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  readRoutes(r, packGuard(view, KEY, "read"), d.reads, d.names);
  writeRoutes(r, view, d.cmd, d.engine ?? (() => "hd8"), d.exec, d.names);
  return r;
}

type R = Hono<PackGuardVars>;

/** CR-127 SG1: gắn `task.claimed_by_name` cho mọi mốc đang có người giữ việc — chỉ tra khi có ít nhất một (một lần cho cả danh sách). */
export async function withClaimerNames<T extends object>(
  rows: T[],
  who: { tenantId: string; userId: string },
  names?: MemberNames,
): Promise<T[]> {
  type Tasked = { task?: { claimed_by: string | null } | null };
  const claimer = (o: T) => (o as Tasked).task?.claimed_by ?? null;
  if (!names || !rows.some(claimer)) return rows;
  const map = await names(who);
  return rows.map((o) => {
    const by = claimer(o);
    return by ? { ...o, task: { ...(o as Tasked).task, claimed_by_name: map.get(by) ?? null } } : o;
  });
}

function readRoutes(
  r: R,
  read: ReturnType<typeof packGuard>,
  reads: LedgerReads,
  names?: MemberNames,
): void {
  const d = { reads };
  r.get("/payments", read, async (c) => {
    const q = parseQuery(c, PaymentsQuerySchema);
    // Luật 4c: JSON của Postgres gửi thẳng (500 hàng: bỏ parse + stringify).
    return c.body(await d.reads.paymentsText(who(c), q.filter), 200, {
      "content-type": "application/json; charset=UTF-8",
    });
  });
  r.get("/obligations", read, async (c) => {
    const q = parseQuery(c, ObligationsQuerySchema);
    return c.json(await withClaimerNames(await d.reads.obligations(who(c), q), who(c), names));
  });
  r.get("/partner-events", read, async (c) => {
    const q = parseQuery(c, PartnerEventsQuerySchema);
    return c.json(await d.reads.events(who(c), q.party, q.role ?? null));
  });
  r.get("/contracts/:id/partner", read, async (c) =>
    c.json(await run(d.reads.partner(who(c), uuid(c.req.param("id"))))),
  );
}

/** Quyền `admin` của gói (mgmt `owner`): chỉnh tay điểm, gỡ cờ đỏ. */
async function isAdmin(view: PackAccessView, c: Context<PackGuardVars>): Promise<boolean> {
  const i = await packAccessInput(view, KEY, c.get("user"));
  return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
}

function writeRoutes(
  r: R,
  view: PackAccessView,
  cmd: LedgerCommands,
  engine: () => RepEngine,
  exec?: ExecCommands,
  names?: MemberNames,
): void {
  const write = packGuard(view, KEY, "write");
  const d = { cmd };
  r.put("/contracts/:id/schedule", write, async (c) => {
    const id = uuid(c.req.param("id"));
    const b = await body(c, ScheduleRequestSchema);
    return c.json(await run(d.cmd.schedule(who(c), id, b.rows)));
  });
  r.post("/obligations/:id/settle", write, async (c) => {
    const id = uuid(c.req.param("id"));
    return c.json(await run(d.cmd.settle(who(c), id, await body(c, SettleRequestSchema))));
  });
  // CR-127 X1 · spec §4.1: ghi thực hiện (SL/tiền thật, phần còn lại, bằng chứng) — một đường với `settle`.
  r.post("/obligations/:id/fulfill", write, async (c) => {
    const id = uuid(c.req.param("id"));
    const b = await body(c, FulfillRequestSchema);
    // SG1: `TASK_CLAIMED` kèm tên người đang giữ việc (một lần tra, chỉ khi lỗi này xảy ra).
    const out = d.cmd.fulfill(who(c), id, b).catch(async (e: unknown) => {
      if (e instanceof LedgerFail && e.kind === "task_claimed") {
        const by = e.detail?.by;
        const name = by && names ? ((await names(who(c))).get(by) ?? null) : null;
        fulfillError(e, name);
      }
      throw e;
    });
    return c.json(await run(out));
  });
  r.post("/obligations/:id/postpone", write, async (c) => {
    const id = uuid(c.req.param("id"));
    if (!exec)
      return c.json(await run(d.cmd.postpone(who(c), id, await body(c, PostponeRequestSchema))));
    // CR-127 X3 · BR-52: dời hạn = yêu cầu thay đổi có bằng chứng (áp ngay hoặc chờ duyệt). Trả mốc sau dời + `state`/`request_id`.
    const b = await body(c, PostponeEvidenceSchema);
    const payload = { to: b.to, ...(b.note ? { note: b.note } : {}) };
    const out = await run(
      exec.requestChange(await execWho(view, c), id, {
        kind: "postpone",
        payload,
        evidence: b.evidence,
      }),
    );
    const { obligation, ...rest } = out;
    return c.json(
      { ...(obligation as object | null), ...rest },
      out.state === "pending" ? 202 : 200,
    );
  });
  r.post("/obligations/:id/remind", write, async (c) => {
    const id = uuid(c.req.param("id"));
    await body(c, RemindRequestSchema);
    return c.json(await run(d.cmd.remind(who(c), id)));
  });
  r.post("/partner-events/:id/void", write, async (c) => {
    const id = eventId(c.req.param("id"));
    const b = await body(c, VoidRequestSchema);
    return c.json(await run(d.cmd.voidEvent(who(c), id, b.reason ?? null, await isAdmin(view, c))));
  });
  r.post("/partner-events", write, async (c) => {
    const b = await body(c, PartnerEventCreateSchema);
    // REP-v3 · CR-101b: BA v2.0 không có chỉnh tay ±10 ⇒ cờ `v2e` đóng ghi mới (dòng cũ giữ chỉ đọc).
    if (b.type === "manual_adjust" && engine() === "v2e")
      throw new AppError("ADJUST_REMOVED", 410, "Không còn chỉnh tay điểm ±10 (BA v2.0, CR-101b)");
    return c.json(await run(d.cmd.record(who(c), b, await isAdmin(view, c))), 201);
  });
}
