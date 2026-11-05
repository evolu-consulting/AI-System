// PK-FR-10 · TF2 · confirmDialog / promptDialog / toast: hợp đồng gọi kiểu lệnh, không treo khi chưa có host.
import { afterEach, describe, expect, mock, test } from "bun:test";

const calls: string[] = [];
mock.module("sonner", () => ({
  toast: {
    success: (m: string) => calls.push(`ok:${m}`),
    error: (m: string) => calls.push(`late:${m}`),
  },
}));

import { confirmDialog, expectHost, promptDialog, type Req, registerHost } from "./dialog-bus";
import { toast } from "./toast";

let unregister = () => {};
afterEach(() => unregister());

describe("dialog-bus", () => {
  test("chưa có host: confirm → false, prompt → null (không treo)", async () => {
    expect(await confirmDialog({ title: "Xoá?" })).toBe(false);
    expect(await promptDialog({ title: "Tên" })).toBeNull();
  });
  test("confirm: host resolve true → true; false → false", async () => {
    unregister = registerHost((r: Req) => r.resolve(true));
    expect(await confirmDialog({ title: "Xoá?" })).toBe(true);
    unregister();
    unregister = registerHost((r: Req) => r.resolve(false));
    expect(await confirmDialog({ title: "Xoá?" })).toBe(false);
  });
  test("prompt: chuỗi trả về nguyên; null (huỷ) → null; request mang kind + tuỳ chọn", async () => {
    let seen: Req | undefined;
    unregister = registerHost((r: Req) => {
      seen = r;
      r.resolve("Tên mới");
    });
    expect(await promptDialog({ title: "Tên", required: true })).toBe("Tên mới");
    expect(seen?.kind).toBe("prompt");
    unregister();
    unregister = registerHost((r: Req) => r.resolve(null));
    expect(await promptDialog({ title: "Tên" })).toBeNull();
  });
  test("host cũ đã gỡ không bị gỡ nhầm host mới", async () => {
    const off1 = registerHost((r: Req) => r.resolve(false));
    unregister = registerHost((r: Req) => r.resolve(true));
    off1();
    expect(await confirmDialog({ title: "x" })).toBe(true);
  });
});

describe("toast", () => {
  test("ok → success, late → error", async () => {
    await toast("Đã lưu");
    await toast("Lỗi", "late");
    expect(calls).toEqual(["ok:Đã lưu", "late:Lỗi"]);
  });
});

describe("dialog-bus · host tải lười (CR-118 bundle)", () => {
  test("expectHost: gọi sớm xếp hàng tới khi host đăng ký; tải lỗi ⇒ trả mặc định", async () => {
    let fail = () => {};
    expectHost(new Promise((_, rej) => (fail = () => rej(new Error("chunk")))));
    const early = confirmDialog({ title: "Xoá?" });
    unregister = registerHost((r: Req) => r.resolve(true));
    expect(await early).toBe(true);
    unregister();
    const lost = promptDialog({ title: "Tên" });
    fail();
    expect(await lost).toBeNull();
  });
});
