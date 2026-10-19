// HD7-FR-03…10 · HD7-NFR-01 · D7-05 · D7-06: route sổ thanh toán dưới `/pack/contracts`. Guard quyền gói TRƯỚC đọc thân/tham số
// (viewer ghi ⇒ 403, 0 SQL); `:id` sai dạng ⇒ 400; tenant/người làm chỉ từ token; thân strict. `LedgerFail` ⇒ mã `LEDGER_ERRORS`;
// tenant khác ⇒ 404 như không có. Chỉnh tay điểm cần quyền `admin` (mgmt `owner`).
import {
  LEDGER_ERRORS,
  type LedgerErrorCode,
  ObligationsQuerySchema,
  PartnerEventCreateSchema,
  PartnerEventsQuerySchema,
  PaymentsQuerySchema,
  PostponeRequestSchema,
  RemindRequestSchema,
  ScheduleRequestSchema,
  SettleRequestSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { checkPackAccess } from "../../kit/domain/pack-access.rules";
import { LedgerFail } from "../application/ledger.ports";
import type { LedgerCommands, LedgerReads } from "../application/ledger.usecase";

const KEY = "contracts";
const FAIL: Record<LedgerFail["kind"], LedgerErrorCode | "NOT_FOUND" | "FORBIDDEN"> = {
  not_found: "NOT_FOUND",
  done: "OBLIGATION_DONE",
  postpone_date: "POSTPONE_DATE",
  system: "EVENT_SYSTEM",
  event_type: "EVENT_TYPE",
  adjust: "ADJUST_INVALID",
  forbidden: "FORBIDDEN",
};
const MESSAGES: Record<LedgerErrorCode, string> = {
  OBLIGATION_DONE: "Đợt này đã xong",
  POSTPONE_DATE: "Ngày hẹn mới phải sau hạn hiện tại",
  EVENT_SYSTEM:
    "Dòng do hệ thống tự ghi không huỷ được; trả rồi thì ghi Đã thu/Đã trả với đúng ngày",
  EVENT_TYPE: "Loại sự kiện không ghi tay được",
  ADJUST_INVALID: "Chỉnh tay từ -10 đến +10 điểm và phải ghi lý do",
};

function ledgerError(e: unknown): never {
  if (!(e instanceof LedgerFail)) throw e;
  const code = FAIL[e.kind];
  if (code === "NOT_FOUND") throw appError("NOT_FOUND");
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

export function ledgerRoutes(
  view: PackAccessView,
  d: { cmd: LedgerCommands; reads: LedgerReads },
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");

  r.get("/payments", read, async (c) => {
    const q = parseQuery(c, PaymentsQuerySchema);
    return c.json(await d.reads.payments(who(c), q.filter));
  });
  r.get("/obligations", read, async (c) => {
    const q = parseQuery(c, ObligationsQuerySchema);
    return c.json(await d.reads.obligations(who(c), q));
  });
  r.get("/partner-events", read, async (c) => {
    const q = parseQuery(c, PartnerEventsQuerySchema);
    return c.json(await d.reads.events(who(c), q.party, q.role ?? null));
  });
  r.get("/contracts/:id/partner", read, async (c) =>
    c.json(await run(d.reads.partner(who(c), uuid(c.req.param("id"))))),
  );
  r.put("/contracts/:id/schedule", write, async (c) => {
    const id = uuid(c.req.param("id"));
    const b = await body(c, ScheduleRequestSchema);
    return c.json(await run(d.cmd.schedule(who(c), id, b.rows)));
  });
  r.post("/obligations/:id/settle", write, async (c) => {
    const id = uuid(c.req.param("id"));
    return c.json(await run(d.cmd.settle(who(c), id, await body(c, SettleRequestSchema))));
  });
  r.post("/obligations/:id/postpone", write, async (c) => {
    const id = uuid(c.req.param("id"));
    return c.json(await run(d.cmd.postpone(who(c), id, await body(c, PostponeRequestSchema))));
  });
  r.post("/obligations/:id/remind", write, async (c) => {
    const id = uuid(c.req.param("id"));
    await body(c, RemindRequestSchema);
    return c.json(await run(d.cmd.remind(who(c), id)));
  });
  r.post("/partner-events/:id/void", write, async (c) => {
    const id = eventId(c.req.param("id"));
    return c.json(await run(d.cmd.voidEvent(who(c), id)));
  });
  r.post("/partner-events", write, async (c) => {
    const b = await body(c, PartnerEventCreateSchema);
    const i = await packAccessInput(view, KEY, c.get("user"));
    const admin = checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
    return c.json(await run(d.cmd.record(who(c), b, admin)), 201);
  });
  return r;
}
