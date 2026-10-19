// HD-FR-07 · HD-AC04 · HD-BR-03 · D-07 · plan §3–§4: `foldVi` / `personKey` / `likePattern` (bản TS của hàm SQL `contracts.fold`/`person_key`).
// Parity TS ↔ SQL từng ký tự ở `columns.int.test.ts`. Không DB.
import { describe, expect, it } from "bun:test";
import { domainFn, likeMatch, VI_PAIRS } from "../_support/pure";

type Fold = (s: string) => string;
type Person = (s: string | null) => string | null;
type Like = (q: string) => string;
const fold = () => domainFn<Fold>("foldVi");
const person = () => domainFn<Person>("personKey");
const like = () => domainFn<Like>("likePattern");

describe("HD-FR-07 · foldVi", () => {
  it("HD-AC04 · ' Nguyễn  Văn A ' ⇒ 'nguyen van a' (hoa/thường, dấu, khoảng trắng thừa)", async () => {
    const f = await fold();
    expect(f(" Nguyễn  Văn A ")).toBe("nguyen van a");
    expect(f("NGUYỄN VĂN A")).toBe("nguyen van a");
    expect(f("Nguyễn\tVăn\nA")).toBe("nguyen van a");
  });
  it("HD-FR-07 · mọi chữ có dấu tiếng Việt, hoa và thường, kể cả đ/Đ ⇒ chữ ASCII tương ứng", async () => {
    const f = await fold();
    const bad: string[] = [];
    for (const [accented, plain] of VI_PAIRS)
      for (const ch of accented) {
        if (f(ch) !== plain) bad.push(`${ch}→${f(ch)}`);
        if (f(ch.toUpperCase()) !== plain) bad.push(`${ch.toUpperCase()}→${f(ch.toUpperCase())}`);
      }
    expect(bad).toEqual([]);
  });
  it("D-18 · chuỗi dấu tổ hợp (NFD) ⇒ chuẩn NFC trước khi bỏ dấu: kết quả như chuỗi dựng sẵn", async () => {
    const f = await fold();
    const nfd = (s: string) => s.normalize("NFD");
    expect(nfd("Nguyễn Văn A")).not.toBe("Nguyễn Văn A"); // tiền đề: thật sự là chuỗi tổ hợp
    expect(f(nfd(" Nguyễn  Văn A "))).toBe("nguyen van a");
    expect(f("ế")).toBe("e"); // ê + sắc tổ hợp = ế
    expect(f("D̂̉")).toBe(f("D̂̉".normalize("NFC")));
    const bad: string[] = [];
    for (const [accented, plain] of VI_PAIRS)
      for (const ch of accented) {
        if (f(nfd(ch)) !== plain) bad.push(`${nfd(ch)}→${f(nfd(ch))}`);
        if (f(nfd(ch.toUpperCase())) !== plain)
          bad.push(`${nfd(ch.toUpperCase())}→${f(nfd(ch.toUpperCase()))}`);
      }
    expect(bad).toEqual([]);
  });
  it("D-18 · fold(NFD x) = fold(NFC x) với mẫu hỗn hợp", async () => {
    const f = await fold();
    for (const s of ["Công ty TNHH Bao Bì Minh Phát", "ĐẶNG THỊ BÉ", "Phạm  Ngọc\tThạch"])
      expect(f(s.normalize("NFD"))).toBe(f(s.normalize("NFC")));
  });
  it("HD-FR-07 · ASCII hoa → thường; số và dấu câu giữ nguyên; chuỗi rỗng ⇒ ''", async () => {
    const f = await fold();
    expect(f("ABC-123/ Đ.ÔNG")).toBe("abc-123/ d.ong");
    expect(f("")).toBe("");
    expect(f("   ")).toBe("");
  });
  it("HD-FR-07 · idempotent: fold(fold(x)) = fold(x)", async () => {
    const f = await fold();
    for (const s of ["Công ty TNHH Bao Bì Minh Phát", "  Đặng  Thị  Bé ", "ABC", ""])
      expect(f(f(s))).toBe(f(s));
  });
});

describe("HD-AC04 · personKey (= personOf + normalize của mgmt)", () => {
  it("HD-AC04 · null / '' / chỉ khoảng trắng ⇒ null", async () => {
    const k = await person();
    expect([k(null), k(""), k("   ")]).toEqual([null, null, null]);
  });
  it("HD-AC04 · 'Nguyễn Văn A' và ' nguyễn văn  a ' cùng khoá", async () => {
    const k = await person();
    expect(k("Nguyễn Văn A")).toBe("nguyen van a");
    expect(k(" nguyễn văn  a ")).toBe(k("Nguyễn Văn A"));
  });
  it("HD-AC04 · cắt phần chức danh: ' – ', ' - ', ',' ⇒ chỉ lấy tên", async () => {
    const k = await person();
    expect(k("Nguyễn Văn A – Giám đốc")).toBe("nguyen van a");
    expect(k("Nguyễn Văn A - Giám đốc")).toBe("nguyen van a");
    expect(k("Nguyễn Văn A, Giám đốc")).toBe("nguyen van a");
  });
  it("HD-AC04 · gạch nối KHÔNG có dấu cách hai bên là một phần tên, không bị cắt", async () => {
    expect((await person())("Trần Anh-Tuấn")).toBe("tran anh-tuan");
  });
  it("D-18 · personKey nhận tên NFD ⇒ cùng khoá với NFC; likePattern(NFD) = likePattern(NFC)", async () => {
    const [k, lp] = [await person(), await like()];
    expect(k("Nguyễn Văn A – Giám đốc".normalize("NFD"))).toBe("nguyen van a");
    expect(k("Trần Anh-Tuấn".normalize("NFD"))).toBe("tran anh-tuan");
    expect(lp("MINH PHÁT".normalize("NFD"))).toBe(lp("MINH PHÁT".normalize("NFC")));
  });
  it("HD-AC04 · phần trước dấu tách rỗng ⇒ null", async () => {
    const k = await person();
    expect(k(" – Giám đốc")).toBeNull();
    expect(k(", Giám đốc")).toBeNull();
  });
});

describe("HD-BR-03 · likePattern — fold + thoát % _ \\ (không để người dùng chèn ký tự đại diện)", () => {
  it("HD-FR-07 · tìm 'minh phát' (có dấu, hoa) khớp khoá đã fold 'hop dong bao bi minh phat'", async () => {
    const [f, lp] = [await fold(), await like()];
    const key = f("Hợp đồng bao bì Minh Phát");
    const p = lp("MINH Phát");
    expect(likeMatch(p, key) || likeMatch(`%${p}%`, key)).toBe(true);
  });
  it("HD-BR-03 · '100%' khớp 'giam 100% phi', KHÔNG khớp 'giam 1000 phi' (dấu % bị thoát)", async () => {
    const lp = await like();
    const p = lp("100%");
    const hit = (s: string) => likeMatch(p, s) || likeMatch(`%${p}%`, s);
    expect(hit("giam 100% phi")).toBe(true);
    expect(hit("giam 1000 phi")).toBe(false);
    expect(hit("giam 100 phi")).toBe(false);
  });
  it("HD-BR-03 · 'a_c' khớp đúng 'a_c', KHÔNG khớp 'abc' (dấu _ bị thoát)", async () => {
    const lp = await like();
    const p = lp("a_c");
    const hit = (s: string) => likeMatch(p, s) || likeMatch(`%${p}%`, s);
    expect(hit("x a_c y")).toBe(true);
    expect(hit("x abc y")).toBe(false);
  });
  it("HD-BR-03 · dấu \\ bị thoát: 'a\\b' khớp 'a\\b' và không bắt nhầm 'ab'", async () => {
    const lp = await like();
    const p = lp("a\\b");
    const hit = (s: string) => likeMatch(p, s) || likeMatch(`%${p}%`, s);
    expect(hit("x a\\b y")).toBe(true);
    expect(hit("x ab y")).toBe(false);
  });
  it("HD-BR-03 · chuỗi có '%' chỉ là ký tự đại diện khi NGUYÊN VĂN, không còn '%' trần ở giữa từ khoá", async () => {
    const p = (await like())("50%_off");
    const inner = p.replace(/^%|%$/g, "");
    expect(/(?<!\\)[%_]/.test(inner)).toBe(false);
  });
});
