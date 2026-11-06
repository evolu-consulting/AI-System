import { describe, expect, it } from "bun:test";
import { foldVi, idKind, type PartnerSearchHit, ROLE_OF_DEAL, suggestMatch } from "./partner-match";

const hit = (party: string, name: string, tax_id: string | null): PartnerSearchHit => ({
  party,
  name,
  tax_id,
  roles: ["supplier"],
});
const GSM = hit("tax:0311110001", "GSM Group", "0311110001");
const GSM2 = hit("tax:0311110002", "GSM Việt Nam", "0311110002");

describe("CR-122 p10 · logic chọn đối tác", () => {
  it("vai theo loại HĐ và nhãn MST hay CCCD", () => {
    expect(ROLE_OF_DEAL).toEqual({
      buy: "supplier",
      sell: "customer",
      referral: "commission_payer",
    });
    expect(idKind("0311-110-001")).toBe("mst");
    expect(idKind("079 123 456 789")).toBe("cccd");
    expect(idKind(null)).toBe("mst");
    expect(foldVi("  Đỗ  Thị Hồng ")).toBe("do thi hong");
  });

  it("khớp MST trước thì đúng một là chắc dù tên khác", () => {
    expect(suggestMatch({ name: "Tên lạ", taxId: "0311.110.001" }, [GSM], [])).toEqual({
      kind: "sure",
      hit: GSM,
    });
  });

  it("khớp tên đúng một thì chắc, MST hai bên khác thì mơ hồ", () => {
    expect(suggestMatch({ name: "gsm group", taxId: "" }, [], [GSM, GSM2])).toEqual({
      kind: "sure",
      hit: GSM,
    });
    expect(suggestMatch({ name: "GSM Group", taxId: "0999999999" }, [], [GSM]).kind).toBe("maybe");
  });

  it("chỉ gần giống thì mơ hồ, không có gì thì none", () => {
    const r = suggestMatch({ name: "GSM", taxId: "" }, [], [GSM, GSM2]);
    expect(r).toEqual({ kind: "maybe", hits: [GSM, GSM2] });
    expect(suggestMatch({ name: "Không có", taxId: "" }, [], []).kind).toBe("none");
    expect(suggestMatch({ name: "", taxId: "" }, [], []).kind).toBe("none");
  });
});
