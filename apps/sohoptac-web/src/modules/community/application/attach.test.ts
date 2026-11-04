// CR-118 · COM-FR-37 · tải nhiều tệp: thêm tệp thành công, báo lỗi 415, báo quá hạn mức.
import { describe, expect, it } from "bun:test";
import { uploadFiles } from "./attach";

const f = (name: string) => new File(["x"], name);
const ok = (name: string, mime: string) => ({ id: crypto.randomUUID(), name, mime, size: 1 });

describe("uploadFiles", () => {
  it("tệp hợp lệ được thêm, lỗi 415 thành khoá thông báo riêng", async () => {
    const api = {
      uploadFile: async (file: File) => {
        if (file.name === "bad.exe") throw Object.assign(new Error("x"), { status: 415 });
        return ok(file.name, file.name.endsWith(".png") ? "image/png" : "application/pdf");
      },
    };
    const r = await uploadFiles(api, [f("a.pdf"), f("bad.exe"), f("b.png")], []);
    expect(r.media.map((m) => `${m.kind}:${m.label}`)).toEqual(["file:a.pdf", "image:b.png"]);
    expect(r.notices).toEqual(["community.composer.fileTypeNotAllowed"]);
  });
  it("quá 10 tệp thì báo tối đa", async () => {
    const api = { uploadFile: async (file: File) => ok(file.name, "application/pdf") };
    const files = Array.from({ length: 11 }, (_, i) => f(`f${i}.pdf`));
    const r = await uploadFiles(api, files, []);
    expect(r.media.length).toBe(10);
    expect(r.notices).toEqual(["community.composer.maxFiles"]);
  });
});
