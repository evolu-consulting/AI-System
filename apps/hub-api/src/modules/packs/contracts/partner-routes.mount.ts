// CR-124 · q4 · FLOW4-FR-06/16 · API màn hình «Hợp đồng đối tác» của app Hợp đồng (`/pack/contracts/partner/*`):
//   GET  /partner/inbox                    — hộp «Hợp đồng đối tác gửi» + lời mời nối đang chờ (quyền read)
//   POST /partner/invites/:from/accept|block — nhận / chặn công ty gửi (quyền write)
//   GET  /partner/sends/:contractId        — các vòng gửi của HĐ phía bên gửi (read)
//   POST /partner/sends/:mailboxId/record  — «Ghi nhận kết quả đối tác» (write; chỉ lần gửi MỞ của HĐ người gọi thấy được)
//   GET/PUT /partner/settings              — ngưỡng mức quan trọng + người phụ trách HĐ nhận (admin)
// Lỗi hàm DEFINER (42501/55000/22023) ⇒ câu nói cách khắc phục, không lộ chi tiết nội bộ.
import type { Db, Tx } from "@ai/db";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../lib/errors";
import { parseWith, readJson } from "../../../lib/http";
import {
  createPackUow,
  type PackAccessView,
  type PackGuardVars,
  type PackUow,
  packGuard,
} from "../kit/public";
import { type PartnerUiRepo, partnerUiRepo } from "./adapters/partner-ui.repo";

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
const SettingsBody = z
  .strictObject({
    important_min: z.number().int().min(0).max(1_000_000_000_000),
    critical_min: z.number().int().min(1).max(1_000_000_000_000),
    owner_user_id: z.uuid().nullable(),
  })
  .refine(
    (s) => s.critical_min > s.important_min,
    "Ngưỡng «Rất quan trọng» phải lớn hơn ngưỡng «Quan trọng».",
  );

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

export function partnerModule(db: Db, view: PackAccessView): Hono<PackGuardVars> {
  const uow: PackUow<{ ui: PartnerUiRepo }> = createPackUow(db, KEY, (tx: Tx, t: string) => ({
    ui: partnerUiRepo(tx, t),
  }));
  const who = (c: { get(k: "user"): { tenantId: string; userId: string } }) => {
    const u = c.get("user");
    return { tenantId: u.tenantId, userId: u.userId };
  };
  const r = new Hono<PackGuardVars>();
  r.get("/partner/inbox", packGuard(view, KEY, "read"), async (c) => {
    const out = await uow.tenant(who(c), async (x) => ({
      items: await x.ui.inbox(),
      invites: await x.ui.invites(),
    }));
    return c.json(out, 200);
  });
  r.post("/partner/invites/:from/:act", packGuard(view, KEY, "write"), async (c) => {
    const from = parseWith(UUID, c.req.param("from"));
    const act = parseWith(z.enum(["accept", "block"]), c.req.param("act"));
    try {
      await uow.tenant(who(c), (x) => (act === "accept" ? x.ui.accept(from) : x.ui.block(from)));
    } catch (e) {
      businessError(e);
    }
    return c.json({ ok: true }, 200);
  });
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
  r.get("/partner/settings", packGuard(view, KEY, "admin"), async (c) =>
    c.json(await uow.tenant(who(c), (x) => x.ui.settings()), 200),
  );
  r.put("/partner/settings", packGuard(view, KEY, "admin"), async (c) => {
    const b = parseWith(SettingsBody, await readJson(c));
    await uow.tenant(who(c), (x) => x.ui.saveSettings(b, c.get("user").userId));
    return c.json({ ok: true }, 200);
  });
  return r;
}
