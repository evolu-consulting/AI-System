// ADM-FR-36 · logic dừng khi tìm user theo username qua nhiều trang.
import { describe, expect, test } from "bun:test";
import { LOOKUP_MAX_PAGES, lookupStep } from "./lookup-user";

const it = (...n: string[]) => n.map((username) => ({ username }));
const base = { total: 500, offset: 0, pages: 1 };

describe("lookupStep", () => {
  test("gặp đúng username → found", () => {
    expect(lookupStep({ ...base, items: it("a", "bob") }, "bob")).toBe("found");
  });
  test("cuối trang còn nhỏ hơn → nạp tiếp", () => {
    expect(lookupStep({ ...base, items: it("a", "b") }, "bob")).toBe("more");
  });
  test("cuối trang lớn hơn vẫn nạp tiếp (collation DB có thể khác JS)", () => {
    expect(lookupStep({ ...base, items: it("a", "carl") }, "bob")).toBe("more");
  });
  test("hết total → dừng", () => {
    expect(lookupStep({ total: 52, offset: 50, pages: 2, items: it("a", "b") }, "bob")).toBe(
      "stop",
    );
  });
  test("trang rỗng → dừng", () => {
    expect(lookupStep({ ...base, items: [] }, "bob")).toBe("stop");
  });
  test("đủ trần trang → dừng", () => {
    expect(lookupStep({ ...base, pages: LOOKUP_MAX_PAGES, items: it("a") }, "bob")).toBe("stop");
  });
});
