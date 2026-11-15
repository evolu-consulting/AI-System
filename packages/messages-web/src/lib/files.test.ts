// CR-132 · W3 · luật thuần tệp đính kèm: định dạng/dung lượng, ảnh hay tệp, cỡ hiển thị, chữ số chưa đọc ở tab.
import { describe, expect, it } from "bun:test";
import { ATTACH_MAX_BYTES } from "@ai/contracts/attach";
import { ATTACH_ACCEPT, fileProblem, isImageMime, sizeLabel } from "./files";

describe("tệp đính kèm", () => {
  it("nhận PDF/Word/Excel/ảnh; đuôi lạ hoặc không đuôi ⇒ type", () => {
    expect(fileProblem({ name: "hd.PDF", size: 10 })).toBeNull();
    expect(fileProblem({ name: "a.png", size: 10 })).toBeNull();
    expect(fileProblem({ name: "x.exe", size: 10 })).toBe("type");
    expect(fileProblem({ name: "pdf", size: 10 })).toBe("type");
  });
  it("tệp rỗng ⇒ empty; quá 20 MB ⇒ size", () => {
    expect(fileProblem({ name: "a.pdf", size: 0 })).toBe("empty");
    expect(fileProblem({ name: "a.pdf", size: ATTACH_MAX_BYTES })).toBeNull();
    expect(fileProblem({ name: "a.pdf", size: ATTACH_MAX_BYTES + 1 })).toBe("size");
  });
  it("accept liệt kê đuôi; ảnh nhận theo MIME; cỡ hiển thị", () => {
    expect(ATTACH_ACCEPT.split(",")).toContain(".docx");
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("application/pdf")).toBe(false);
    expect(sizeLabel(12)).toBe("12 B");
    expect(sizeLabel(2048)).toBe("2 KB");
    expect(sizeLabel(1_258_291)).toBe("1,2 MB");
  });
});
