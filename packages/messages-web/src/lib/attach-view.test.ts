import { describe, expect, test } from "bun:test";
import { attachLabels, toAttachItem, toDraftItem } from "./attach-view";

describe("CR-169 · attach-view", () => {
  test("FileRef ⇒ mục chung giữ id/tên/mime/cỡ", () => {
    const f = { id: "i", name: "a.pdf", mime: "application/pdf", size: 5 } as const;
    expect(toAttachItem(f)).toEqual({ id: "i", name: "a.pdf", mime: "application/pdf", size: 5 });
  });
  test("tệp đang chọn ⇒ mục nháp (có file cục bộ thì mang theo)", () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    const d = toDraftItem({
      key: "k",
      name: "a.png",
      mime: "image/png",
      size: 1,
      file,
      status: "uploading",
    });
    expect(d).toMatchObject({ id: "k", status: "uploading", file });
    expect(
      toDraftItem({ key: "k", name: "b", mime: "x", size: 1, status: "ready" }),
    ).not.toHaveProperty("file");
  });
  test("nhãn đi qua i18n (khoá có tên tệp)", () => {
    const l = attachLabels((k, o) => `${k}|${String(o?.name ?? "")}`);
    expect(l.remove("a.pdf")).toBe("contracts.messages.removeFile|a.pdf");
    expect(l.prev).toBe("contracts.messages.attachUi.prev|");
  });
});
