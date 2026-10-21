// feedback · luật thuần: chữ ký byte khớp loại khai báo, trần 2 MB, tên tệp sạch.
import { describe, expect, it } from "bun:test";
import { cleanName, decodeFiles, seesAll } from "./feedback.rules";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("feedback.rules", () => {
  it("PNG thật qua; khai PNG mà byte là chữ thường ⇒ từ chối đúng chỉ số", () => {
    const ok = decodeFiles([{ name: "a.png", mime: "image/png", data_base64: PNG }]);
    expect(ok.ok).toBe(true);
    const bad = decodeFiles([
      { name: "a.png", mime: "image/png", data_base64: PNG },
      { name: "b.png", mime: "image/png", data_base64: Buffer.from("hello").toString("base64") },
    ]);
    expect(bad).toEqual({ ok: false, index: 1 });
  });

  it("quá 2 MB bị từ chối; tên bỏ đường dẫn + dấu nháy", () => {
    const big = Buffer.concat([Buffer.from("%PDF"), Buffer.alloc(2 * 1024 * 1024)]).toString(
      "base64",
    );
    expect(decodeFiles([{ name: "x.pdf", mime: "application/pdf", data_base64: big }]).ok).toBe(
      false,
    );
    expect(cleanName('C:\\tmp\\..\\a"b.png')).toBe("ab.png");
    expect(cleanName("   ")).toBe("file");
  });

  it("chỉ admin xem hết", () => {
    expect([seesAll("member"), seesAll("tenant_admin"), seesAll("platform_admin")]).toEqual([
      false,
      true,
      true,
    ]);
  });
});
