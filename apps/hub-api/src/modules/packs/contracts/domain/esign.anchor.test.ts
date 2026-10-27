// esign-anchor · unit luật chọn anchor: có/không cụm, trùng, mơ hồ, hoa thường, NFC, hướng mua/bán.
import { describe, expect, it } from "bun:test";
import {
  cleanList,
  companyLetter,
  companySideOf,
  DEFAULT_ANCHORS,
  pickAnchors,
  type SignerRole,
} from "./esign.anchor";

const body = "Điều 1. Hàng hoá. ".repeat(120);
const head = "HỢP ĐỒNG MUA BÁN\nBên A: Công ty X\nBên B: Công ty Y\n";
const sig =
  "\n\nĐẠI DIỆN BÊN A          ĐẠI DIỆN BÊN B\n(Ký, ghi rõ họ tên)   (Ký, ghi rõ họ tên)\n";
const both: readonly SignerRole[] = ["company", "partner"];
const pick = (text: string | null, side: "seller" | "buyer" | null = "buyer", roles = both) =>
  pickAnchors({ text, side, roles, lists: DEFAULT_ANCHORS });

describe("esign-anchor · pickAnchors", () => {
  it("khối chữ ký cuối có ĐẠI DIỆN BÊN A/B ⇒ anchor văn bản theo thứ tự người ký", () => {
    expect(pick(head + body + sig)).toEqual({
      mode: "text",
      anchors: ["ĐẠI DIỆN BÊN A", "ĐẠI DIỆN BÊN B"],
    });
    expect(pick(head + body + sig, "buyer", ["partner", "company"])).toEqual({
      mode: "text",
      anchors: ["ĐẠI DIỆN BÊN B", "ĐẠI DIỆN BÊN A"],
    });
  });

  it("không có văn bản / file scan ⇒ trang ký cuối", () => {
    expect(pick(null)).toEqual({ mode: "page", reason: "no-text" });
    expect(pick("   \n ")).toEqual({ mode: "page", reason: "no-text" });
  });

  it("không có cụm ở phần cuối ⇒ trang ký cuối", () => {
    expect(pick(head + body)).toEqual({ mode: "page", reason: "not-found" });
    // cụm chỉ ở đầu văn bản (không phải khối chữ ký)
    expect(pick(`ĐẠI DIỆN BÊN A ĐẠI DIỆN BÊN B ${body}`)).toEqual({
      mode: "page",
      reason: "not-found",
    });
  });

  it("cụm xuất hiện 2 lần (DocuSign đặt tab ở mọi chỗ) ⇒ trang ký cuối", () => {
    expect(pick(head + body + sig + sig).mode).toBe("page");
    expect(pick(`ĐẠI DIỆN BÊN A ${body}${sig}`).mode).toBe("page");
  });

  it("không phân biệt hoa thường, gộp khoảng trắng, NFC (văn bản NFD)", () => {
    const low = "\n\nđại   diện\nbên a      Đại Diện Bên B\n";
    expect(pick(body + low)).toEqual({
      mode: "text",
      anchors: ["đại diện bên a", "Đại Diện Bên B"],
    });
    const nfd = (body + sig).normalize("NFD");
    expect(pick(nfd)).toEqual({ mode: "text", anchors: ["ĐẠI DIỆN BÊN A", "ĐẠI DIỆN BÊN B"] });
  });

  it("nguyên từ: 'BÊN AN' không khớp 'BÊN A'", () => {
    expect(pick(`${body}\nBÊN AN   BÊN B\n`).mode).toBe("page");
  });

  it("hướng HĐ: bán ⇒ công ty = BÊN BÁN; mua ⇒ công ty = BÊN MUA", () => {
    const t = `${body}\n\nĐẠI DIỆN BÊN BÁN      ĐẠI DIỆN BÊN MUA\n`;
    expect(pick(t, "seller")).toEqual({
      mode: "text",
      anchors: ["ĐẠI DIỆN BÊN BÁN", "ĐẠI DIỆN BÊN MUA"],
    });
    expect(pick(t, "buyer")).toEqual({
      mode: "text",
      anchors: ["ĐẠI DIỆN BÊN MUA", "ĐẠI DIỆN BÊN BÁN"],
    });
    expect(pick(t, null).mode).toBe("page"); // không rõ hướng ⇒ không đoán mua/bán
  });

  it("văn bản gán 'Bên mua (Bên B)' + HĐ mua ⇒ công ty = Bên B", () => {
    const t = `BÊN BÁN (BÊN A): Công ty Y\nBÊN MUA (BÊN B): Công ty X\n${body}${sig}`;
    expect(pick(t, "buyer")).toEqual({
      mode: "text",
      anchors: ["ĐẠI DIỆN BÊN B", "ĐẠI DIỆN BÊN A"],
    });
    expect(pick(t, "seller").mode).toBe("text");
    expect((pick(t, "seller") as { anchors: string[] }).anchors[0]).toBe("ĐẠI DIỆN BÊN A");
  });

  it("gán mâu thuẫn ⇒ mơ hồ ⇒ trang ký cuối", () => {
    const t = `Bên mua (Bên A) … Bên bán (Bên A)\n${body}${sig}`;
    expect(pick(t, "buyer")).toEqual({ mode: "page", reason: "ambiguous" });
  });

  it("hai người ký cùng vai / không người ký ⇒ trang ký cuối", () => {
    expect(pick(body + sig, "buyer", ["partner", "partner"] as never)).toEqual({
      mode: "page",
      reason: "signers",
    });
    expect(pick(body + sig, "buyer", [] as never).mode).toBe("page");
  });

  it("chỉ người ký đối tác ⇒ anchor đối tác", () => {
    expect(pick(body + sig, "buyer", ["partner"] as never)).toEqual({
      mode: "text",
      anchors: ["ĐẠI DIỆN BÊN B"],
    });
  });

  it("danh sách tuỳ chỉnh của công ty được ưu tiên", () => {
    const t = `${body}\n\nTHAY MẶT CÔNG TY X     THAY MẶT CÔNG TY Y\n`;
    const r = pickAnchors({
      text: t,
      side: null,
      roles: both,
      lists: { a: ["Thay mặt Công ty X"], b: ["thay mặt công ty y"] },
    });
    expect(r).toEqual({ mode: "text", anchors: ["THAY MẶT CÔNG TY X", "THAY MẶT CÔNG TY Y"] });
  });
});

describe("esign-anchor · phụ trợ", () => {
  it("companySideOf: deal ưu tiên, rồi direction; giới thiệu ⇒ null", () => {
    expect(companySideOf("sell", "purchase")).toBe("seller");
    expect(companySideOf("buy", null)).toBe("buyer");
    expect(companySideOf("referral", "sale")).toBeNull();
    expect(companySideOf(null, "sale")).toBe("seller");
    expect(companySideOf(null, "purchase")).toBe("buyer");
    expect(companySideOf(null, null)).toBeNull();
  });

  it("companyLetter: mặc định a; theo gán 'gọi tắt là'", () => {
    expect(companyLetter("không gán gì", "buyer")).toBe("a");
    expect(companyLetter('bên bán, sau đây gọi tắt là "bên b"', "buyer")).toBe("a");
    expect(companyLetter("bên a (bên bán)", "seller")).toBe("a");
    expect(companyLetter("bên a (bên bán)", "buyer")).toBe("b");
  });

  it("cleanList: NFC, gộp khoảng trắng, bỏ rỗng/trùng", () => {
    expect(cleanList(["  Bên  A ", "bên a", "", "BÊN B".normalize("NFD")])).toEqual([
      "Bên A",
      "BÊN B",
    ]);
  });
});
