// N2-FR-03 · review Trung #1 (hạn + huỷ), security M2 (quyền theo `action`), L1 (trùng khoá workflow catalog), review Thấp 9 (log).
import { describe, expect, test } from "bun:test";
import type { PackToolDef } from "../application/pack-tools.ports";
import type { PackAccessView } from "./pack-guard.middleware";
import { PackToolRegistry } from "./pack-tools.registry";

const T = "t1";
const F = { read: "f-r", write: "f-w" };
/** Gói `pk` bật cho t1; Group g-read được `read`, g-write được `write`. */
const view = (groups: string[]): PackAccessView => ({
  catalog: async () => ({
    features: [
      { id: F.read, key: "pk-read", status: "on" },
      { id: F.write, key: "pk-write", status: "on" },
    ],
    entitled: new Set([`${T}:${F.read}`, `${T}:${F.write}`]),
    grantGroups: new Map([
      [`${T}:${F.read}`, ["g-read"]],
      [`${T}:${F.write}`, ["g-write"]],
    ]),
  }),
  user: async () => ({ tenantId: T, groupIds: new Set(groups) }),
});
const tool = (o: Partial<PackToolDef> = {}): PackToolDef => ({
  pack: "pk",
  name: "pk-a",
  description: "",
  side_effect: false,
  params: [],
  run: async () => ({ ok: 1 }),
  ...o,
});
const ctx = { tenantId: T, userId: "u", runId: "r" };

describe("PackToolRegistry · hạn + lỗi", () => {
  test("hạn: tool treo ⇒ TIMEOUT (sent = side_effect), tool nhận signal huỷ", async () => {
    let aborted = false;
    const reg = new PackToolRegistry();
    reg.register(
      tool({
        side_effect: true,
        run: (c) =>
          new Promise(() => {
            c.signal?.addEventListener("abort", () => {
              aborted = true;
            });
          }),
      }),
    );
    const r = await reg.call("pk-a", ctx, {}, { timeoutS: 0.02 });
    expect(r).toMatchObject({ kind: "failed", code: "TIMEOUT", sent: true });
    expect(aborted).toBe(true);
  });

  test("huỷ từ ngoài (signal) ⇒ TIMEOUT ngay; lỗi tool ⇒ UPSTREAM_ERROR + log", async () => {
    const logs: string[] = [];
    const reg = new PackToolRegistry();
    reg.bindView(view([]), (m) => logs.push(m));
    reg.register(tool({ run: () => new Promise(() => {}) }));
    reg.register(tool({ name: "pk-b", run: async () => Promise.reject(new Error("x")) }));
    const ac = new AbortController();
    const p = reg.call("pk-a", ctx, {}, { signal: ac.signal });
    ac.abort();
    expect(await p).toMatchObject({ kind: "failed", code: "TIMEOUT", sent: false });
    expect(await reg.call("pk-b", ctx, {})).toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(logs).toContain("pack-tool-failed");
  });
});

describe("PackToolRegistry · quyền + khoá", () => {
  test("M2 · canUse theo action (mặc định write): viewer (read) không dùng được tool ghi", async () => {
    const reg = new PackToolRegistry();
    reg.register(tool());
    reg.register(tool({ name: "pk-r", action: "read" }));
    reg.bindView(view(["g-read"]));
    const who = { tenantId: T, userId: "u" };
    expect(await reg.canUse(who, "pk-a")).toBe(false);
    expect(await reg.canUse(who, "pk-r")).toBe(true);
    reg.bindView(view(["g-write"]));
    expect(await reg.canUse(who, "pk-a")).toBe(true);
  });

  test("L1 · khoá trùng workflow catalog bị gỡ + log; khoá khác giữ", () => {
    const logs: string[] = [];
    const reg = new PackToolRegistry();
    reg.bindView(view([]), (m) => logs.push(m));
    reg.register(tool());
    reg.register(tool({ name: "pk-b" }));
    expect(reg.rejectCatalogCollisions(new Set(["pk-a", "khac"]))).toEqual(["pk-a"]);
    expect([reg.has("pk-a"), reg.has("pk-b")]).toEqual([false, true]);
    expect(logs).toEqual(["pack-tool-key-collision"]);
  });
});
