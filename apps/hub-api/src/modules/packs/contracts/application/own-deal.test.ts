// V2-L · V2-G: công ty mình đứng bên nào ⇒ chốt Mua/Bán cho bản AI đọc.
import { describe, expect, it } from "bun:test";
import { ownDeal } from "../domain/own-side.rules";
import { withOwnDeal } from "./run-extraction.usecase";

const own = { names: ["Công ty CP NITI GROUP"], taxIds: ["0312345678"] };
const side = (name: string | null, tax: string | null) => ({ name, tax });

describe("ownDeal", () => {
  it("mình là bên cung cấp ⇒ sell; bên mua ⇒ buy (khớp MST, bỏ mã chi nhánh, hoặc tên không dấu/hoa thường)", () => {
    expect(
      ownDeal(
        { supplier: side(null, "0312345678-001"), buyer: side("Hưng Thịnh", "0100000001") },
        own,
      ),
    ).toBe("sell");
    expect(
      ownDeal(
        { supplier: side("Hưng Thịnh", null), buyer: side("CONG TY CP NITI GROUP", null) },
        own,
      ),
    ).toBe("buy");
  });
  it("không khớp bên nào / khớp cả hai / chưa khai pháp nhân ⇒ null", () => {
    expect(ownDeal({ supplier: side("A", "0100000001"), buyer: side("B", null) }, own)).toBeNull();
    expect(
      ownDeal(
        { supplier: side("NITI GROUP", "0312345678"), buyer: side("Công ty CP NITI GROUP", null) },
        own,
      ),
    ).toBeNull();
    expect(
      ownDeal(
        { supplier: side(null, "0312345678"), buyer: side(null, null) },
        { names: [], taxIds: [] },
      ),
    ).toBeNull();
  });
});

describe("withOwnDeal", () => {
  const v = (name: string, tax: string) => ({ value: name === "" ? null : name, tax }) as never;
  const out = (deal: "buy" | "sell" | "referral") =>
    ({
      fields: {
        supplier_name: { value: "Công ty CP NITI GROUP" },
        supplier_tax_id: { value: null },
        buyer_name: { value: "Hưng Thịnh" },
        buyer_tax_id: { value: null },
      },
      items: null,
      clauses: [],
      ai: { deal, unsure: ["deal", "end_date"], summary: null, milestones: [] },
    }) as never as Parameters<typeof withOwnDeal>[0];
  it("biết bên mình ⇒ đặt deal và bỏ 'deal' khỏi chưa chắc", () => {
    void v;
    const r = withOwnDeal(out("buy"), own);
    expect(r.ai?.deal).toBe("sell");
    expect(r.ai?.unsure).toEqual(["end_date"]);
  });
  it("Giới thiệu hoặc chưa khai pháp nhân ⇒ giữ nguyên", () => {
    expect(withOwnDeal(out("referral"), own).ai?.deal).toBe("referral");
    expect(withOwnDeal(out("buy"), { names: [], taxIds: [] }).ai?.unsure).toContain("deal");
  });
});
