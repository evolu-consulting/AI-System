// CR-124 · q4 · FLOW4-FR-06/16 · API màn hình «Hợp đồng đối tác» của app Hợp đồng (`/pack/contracts/partner/*`):
//   GET  /partner/inbox                    — hộp «Hợp đồng đối tác gửi» + lời mời nối đang chờ (quyền read)
//   POST /partner/invites/:from/accept|block — nhận / chặn công ty gửi (quyền admin: quyết định của CÔNG TY, không phải của người dùng)
//   GET  /partner/sends/:contractId        — các vòng gửi của HĐ phía bên gửi (read)
//   POST /partner/sends/:mailboxId/record  — «Ghi nhận kết quả đối tác» (write; chỉ lần gửi MỞ của HĐ người gọi thấy được)
//   GET/PUT /partner/settings              — ngưỡng mức quan trọng + người phụ trách HĐ nhận (admin)
//   POST /contracts/:id/inbox-decision     — CR-127 K8 · người phụ trách HĐ nhận quyết khi chưa có quy trình nhận (write; owner/admin)
// Lỗi hàm DEFINER (42501/55000/22023) ⇒ câu nói cách khắc phục, không lộ chi tiết nội bộ.
import {
  INBOX_DECISION_ERRORS,
  type InboxDecisionErrorCode,
  InboxDecisionRequestSchema,
} from "@ai/contracts/pack-contracts";
import { CONTRACTS_PARTNER_CONFIRM_FEATURE as PARTNER_FEATURE } from "@ai/contracts/tenants";
import type { Db, Tx } from "@ai/db";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { z } from "zod";
import { AppError, appError } from "../../../lib/errors";
import { parseWith, readJson } from "../../../lib/http";
import {
  createPackUow,
  type PackAccessView,
  type PackGuardVars,
  type PackUow,
  packAccessInput,
  packActionsFor,
  packGuard,
  tenantFeatureOn,
} from "../kit/public";
import { decideInbox, InboxReplyClosed } from "./adapters/partner-inbox-decision.repo";
import { type PartnerUiRepo, partnerUiRepo } from "./adapters/partner-ui.repo";
import { connectModule } from "./connect/connect.mount";
import { signSessionRoutes } from "./sign-session.routes";

const KEY = "contracts";
const UUID = z.uuid();

const RecordBody = z.strictObject({
  outcome: z.enum(["confirmed", "returned", "declined"]),
  reason: z.string().trim().max(2000).optional(),
  /** Người bên đối tác trả lời: tên · chức vụ (spec §8b). */
  by_name: z.string().trim().min(1).max(200),
  by_title: z.string().trim().max(200).optional(),
  /** Bằng chứng: ảnh email / biên bản — ghi tên + ghi chú (≥ 1 khi kênh thủ công). */
  evidence: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(200),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .max(20)
    .default([]),
});
const pgCode = (e: unknown): string | undefined =>
  (e as { code?: string; cause?: { code?: string } })?.code ??
  (e as { cause?: { code?: string } })?.cause?.code;

/** Lỗi hàm DEFINER ⇒ câu nghiệp vụ. */
function businessError(e: unknown): never {
  const c = pgCode(e);
  if (c === "55000")
    throw new AppError("PARTNER_SEND_CLOSED", 409, "Lần gửi này đã có kết quả hoặc đã hết hạn.");
  if (c === "22023")
    throw new AppError(
      "PARTNER_INPUT_INVALID",
      422,
      "Thiếu lý do hoặc bằng chứng — Trả lại / Từ chối cần lý do; kênh thủ công cần ít nhất một bằng chứng.",
    );
  if (c === "42501") throw appError("NOT_FOUND");
  throw e;
}

type PartnerUow = PackUow<{ ui: PartnerUiRepo; tx: Tx; tid: string }>;
type PartnerRouter = Hono<PackGuardVars>;
const who = (c: { get(k: "user"): { tenantId: string; userId: string } }) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};

function sendRoutes(r: PartnerRouter, view: PackAccessView, uow: PartnerUow): void {
  r.get("/partner/sends/:contractId", packGuard(view, KEY, "read"), async (c) => {
    const id = parseWith(UUID, c.req.param("contractId"));
    return c.json({ rounds: await uow.tenant(who(c), (x) => x.ui.sends(id)) }, 200);
  });
  r.post("/partner/sends/:mailboxId/record", packGuard(view, KEY, "write"), async (c) => {
    const id = parseWith(UUID, c.req.param("mailboxId"));
    const b = parseWith(RecordBody, await readJson(c));
    try {
      await uow.tenant(who(c), async (x) => {
        if (!(await x.ui.openSend(id))) throw appError("NOT_FOUND");
        await x.ui.recordManual(id, b.outcome, b.reason || null, {
          by_name: b.by_name,
          ...(b.by_title ? { by_title: b.by_title } : {}),
          files: b.evidence,
        });
      });
    } catch (e) {
      if (e instanceof AppError) throw e;
      businessError(e);
    }
    return c.json({ ok: true }, 200);
  });
}

const INBOX_MSG: Record<InboxDecisionErrorCode, string> = {
  INBOX_NOT_AWAITING: "Hợp đồng này không còn chờ bạn quyết — tải lại trang.",
  INBOX_REPLY_CLOSED: "Lần gửi của đối tác đã hết hạn hoặc đã có trả lời — nhờ đối tác gửi lại.",
  FEEDBACK_REQUIRED: "Ghi ý kiến khi Trả lại hoặc Từ chối.",
  INBOX_DECISION_FORBIDDEN: "Chỉ người phụ trách hợp đồng nhận hoặc quản trị công ty được quyết.",
};
const inboxFail = (k: InboxDecisionErrorCode): never => {
  throw new AppError(k, INBOX_DECISION_ERRORS[k], INBOX_MSG[k]);
};

/** CR-127 K8 · spec §3 #9b: HĐ nhận chờ người phụ trách quyết (không nằm dưới `/partner/*` — không phụ thuộc tính năng gửi đối tác). */
function inboxDecisionRoute(r: PartnerRouter, view: PackAccessView, uow: PartnerUow): void {
  r.post("/contracts/:id/inbox-decision", packGuard(view, KEY, "write"), async (c) => {
    const id = parseWith(UUID, c.req.param("id"));
    const b = parseWith(InboxDecisionRequestSchema, await readJson(c));
    if (b.decision !== "accept" && !b.evidence?.note?.trim()) inboxFail("FEEDBACK_REQUIRED");
    const u = c.get("user");
    const isAdmin = packActionsFor(await packAccessInput(view, KEY, u)).includes("admin");
    const out = await uow
      .tenant(who(c), (x) =>
        decideInbox(x.tx, x.tid, {
          contractId: id,
          decision: b.decision,
          actorId: u.userId,
          isAdmin,
          evidence: b.evidence ?? null,
        }),
      )
      .catch((e: unknown) => {
        if (e instanceof InboxReplyClosed) inboxFail("INBOX_REPLY_CLOSED");
        throw e;
      });
    if ("error" in out) {
      if (out.error === "not_found") throw appError("NOT_FOUND");
      inboxFail(out.error);
    }
    return c.json(out, 200);
  });
}

export function partnerModule(
  db: Db,
  view: PackAccessView,
  deps: { redis?: Redis | undefined } = {},
): Hono<PackGuardVars> {
  const uow: PartnerUow = createPackUow(db, KEY, (tx: Tx, t: string) => ({
    ui: partnerUiRepo(tx, t),
    tx,
    tid: t,
  }));
  const r = new Hono<PackGuardVars>();
  // q7 · MỌI route `/partner/*` cần công ty đã bật tính năng `contracts-partner-confirm` — cùng nguồn (`tenantFeatureOn`) với cap menu.
  r.use("/partner/*", async (c, next) => {
    if (!(await tenantFeatureOn(view, PARTNER_FEATURE, c.get("user").tenantId)))
      throw new AppError(
        "PARTNER_FEATURE_OFF",
        403,
        "Công ty chưa bật Gửi đối tác xác nhận — nhờ quản trị nền tảng bật tính năng này.",
      );
    await next();
  });
  r.get("/partner/inbox", packGuard(view, KEY, "read"), async (c) => {
    const out = await uow.tenant(who(c), async (x) => ({
      items: await x.ui.inbox(),
      invites: await x.ui.invites(),
    }));
    return c.json(out, 200);
  });
  r.post("/partner/invites/:from/:act", packGuard(view, KEY, "admin"), async (c) => {
    const from = parseWith(UUID, c.req.param("from"));
    const act = parseWith(z.enum(["accept", "block"]), c.req.param("act"));
    try {
      await uow.tenant(who(c), (x) => (act === "accept" ? x.ui.accept(from) : x.ui.block(from)));
    } catch (e) {
      businessError(e);
    }
    return c.json({ ok: true }, 200);
  });
  sendRoutes(r, view, uow);
  inboxDecisionRoute(r, view, uow);
  r.route("/", signSessionRoutes(db, view, uow)); // CR-127 · P2 · phiên ký chung
  r.route("/", connectModule(db, view, deps)); // CR-161 · kết nối hai công ty + bài công khai (`/connect/*`)
  return r;
}
