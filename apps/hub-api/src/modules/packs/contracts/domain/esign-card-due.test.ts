// esign-sweep2 · luật thuần ô bước Ký số trên thẻ: hạn ký = `esign_at + due_h` (chỉ khi đã gửi chờ ký), quá hạn theo giờ server,
// "đã nhắc" chỉ tính lần nhắc của lần gửi hiện tại; schema thẻ nhận trường mới (tuỳ chọn).
import { describe, expect, it } from "bun:test";
import { ContractApprovalSchema } from "@ai/contracts";
import type { FlowEsignStep } from "./approval-flow.types";
import { esignCard, esignDue } from "./approval-flow-esign.rules";

const step: FlowEsignStep = {
  kind: "esign",
  key: "sign",
  name: "Ký số",
  company_signer: { mode: "owner" },
  partner_signs: false,
  order: "company_first",
  provider: null,
  due_h: 72,
  remind_every_h: 24,
  escalate_group_id: null,
};
const AT = "2026-10-20T00:00:00.000Z";
const now = (h: number) => new Date(Date.parse(AT) + h * 3_600_000);

describe("esign-sweep2 · hạn ký / quá hạn / đã nhắc", () => {
  it("đã gửi: hạn = esign_at + due_h; chưa tới hạn ⇒ không quá hạn; nhắc của lần gửi hiện tại", () => {
    const r = esignDue(step, "sent", {
      at: AT,
      remindedAt: "2026-10-21T00:00:00.000Z",
      now: now(30),
    });
    expect(r).toEqual({
      due_at: "2026-10-23T00:00:00.000Z",
      overdue: false,
      reminded_at: "2026-10-21T00:00:00.000Z",
    });
  });

  it("đúng mốc hạn trở đi ⇒ quá hạn; mốc nhắc cũ hơn lần gửi ⇒ bỏ", () => {
    const r = esignDue(step, "sent", {
      at: AT,
      remindedAt: "2026-10-19T00:00:00.000Z",
      now: now(72),
    });
    expect(r.overdue).toBe(true);
    expect(r.reminded_at).toBeNull();
  });

  it("không phải `sent` / thiếu mốc ⇒ không hạn, không quá hạn", () => {
    const off = { due_at: null, overdue: false, reminded_at: null };
    for (const st of ["pending", "sending", "completed", "needs_decision"] as const)
      expect(esignDue(step, st, { at: AT, remindedAt: AT, now: now(100) })).toEqual(off);
    expect(esignDue(step, "sent", { at: null, remindedAt: null, now: now(1) })).toEqual(off);
    expect(esignDue(step, "sent", undefined)).toEqual(off);
  });

  it("thẻ mang trường mới và qua schema hợp đồng (trường tuỳ chọn)", () => {
    const e = esignCard([step], "sent", null, false, false, {
      at: AT,
      remindedAt: null,
      now: now(80),
    });
    expect(e).toMatchObject({ status: "sent", overdue: true, due_at: "2026-10-23T00:00:00.000Z" });
    const shape = ContractApprovalSchema.shape.esign.unwrap().unwrap();
    expect(shape.safeParse(e).success).toBe(true);
    const { due_at: _d, overdue: _o, reminded_at: _r, ...old } = e as NonNullable<typeof e>;
    expect(shape.safeParse(old).success).toBe(true); // hub cũ không có trường mới
  });
});
