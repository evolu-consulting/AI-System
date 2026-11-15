// fix-extract-save · luật thuần (deal, direction, doc_type) AI điền khi trích — phản chiếu CHECK `contracts_deal_ck`.
import { describe, expect, it } from "bun:test";
import { aiDealWrite, type DealRow, dealCheckOk } from "./deal-direction.rules";
import type { AiRead } from "./extraction.types";

const ai = (deal: AiRead["deal"], kind_terms?: Record<string, unknown>): AiRead =>
  ({
    deal,
    unsure: [],
    summary: null,
    milestones: [],
    ...(kind_terms ? { kind_terms } : {}),
  }) as AiRead;
const empty: DealRow = { deal: null, direction: null, docType: "contract" };

describe("dealCheckOk · khớp contracts_deal_ck", () => {
  it("không có deal ⇒ luôn hợp lệ; có deal mà thiếu hướng ⇒ sai", () => {
    expect(dealCheckOk(null, null, "contract")).toBe(true);
    expect(dealCheckOk("franchise", null, "contract")).toBe(false);
  });
  it("buy ⇔ purchase; sell/referral ⇒ sale", () => {
    expect(dealCheckOk("buy", "purchase", "contract")).toBe(true);
    expect(dealCheckOk("buy", "sale", "contract")).toBe(false);
    expect(dealCheckOk("sell", "purchase", "contract")).toBe(false);
    expect(dealCheckOk("referral", "sale", "contract")).toBe(true);
  });
  it("franchise: sale|purchase + chỉ loại 'contract'; cooperation: chỉ sale + 'contract'", () => {
    expect(dealCheckOk("franchise", "purchase", "contract")).toBe(true);
    expect(dealCheckOk("franchise", "sale", "deal")).toBe(false);
    expect(dealCheckOk("cooperation", "sale", "contract")).toBe(true);
    expect(dealCheckOk("cooperation", "purchase", "contract")).toBe(false);
  });
});

describe("aiDealWrite", () => {
  it("Nhượng quyền (HĐ 28 trang trên staging): hướng trống ⇒ suy theo vai, không còn deal không hướng", () => {
    expect(aiDealWrite(empty, ai("franchise"))).toEqual({ deal: "franchise", direction: "sale" });
    expect(aiDealWrite(empty, ai("franchise", { role: "franchisee" }))).toEqual({
      deal: "franchise",
      direction: "purchase",
    });
  });
  it("Hợp tác mà hướng đã là purchase ⇒ tổ hợp sai ⇒ bỏ deal, giữ hướng", () => {
    const cur = { ...empty, direction: "purchase" };
    expect(aiDealWrite(cur, ai("cooperation"))).toEqual({ deal: null, direction: "purchase" });
  });
  it("Nhượng quyền / Hợp tác trên chứng từ không phải 'contract' ⇒ bỏ deal", () => {
    expect(aiDealWrite({ ...empty, docType: "deal" }, ai("franchise"))).toEqual({
      deal: null,
      direction: null,
    });
  });
  it("Mua/Bán/Giới thiệu: hướng suy từ loại; hướng có sẵn trái loại ⇒ bỏ deal", () => {
    expect(aiDealWrite(empty, ai("buy"))).toEqual({ deal: "buy", direction: "purchase" });
    expect(aiDealWrite(empty, ai("referral"))).toEqual({ deal: "referral", direction: "sale" });
    expect(aiDealWrite({ ...empty, direction: "purchase" }, ai("sell"))).toEqual({
      deal: null,
      direction: "purchase",
    });
  });
  it("người dùng đã chọn loại ⇒ giữ nguyên; AI không đoán loại ⇒ giữ nguyên", () => {
    const set = { deal: "sell", direction: "sale", docType: "contract" };
    expect(aiDealWrite(set, ai("buy"))).toEqual({ deal: "sell", direction: "sale" });
    expect(aiDealWrite(empty, ai(null))).toEqual({ deal: null, direction: null });
    expect(aiDealWrite(empty, null)).toEqual({ deal: null, direction: null });
  });
});
