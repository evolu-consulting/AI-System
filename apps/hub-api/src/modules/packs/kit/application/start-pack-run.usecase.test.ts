// N2-FR-01 · N2-D04 · khuôn khởi chạy run từ gói: kiểm bản ghi trước khi mở run; gắn thất bại ⇒ huỷ bù, không kick.
import { describe, expect, test } from "bun:test";
import type { PackRunsPort } from "./pack-runs.ports";
import { startPackRun } from "./start-pack-run.usecase";

const U = { userId: "u", tenantId: "t", role: "member" };
const REQ = { process_key: "p", input: "x" };

function harness(check: "ok" | "not_found" | "has_run", attach: boolean | Error) {
  const log: string[] = [];
  const port: PackRunsPort = {
    start: async () => {
      log.push("start");
      return { runId: "r1", kick: async () => void log.push("kick") };
    },
    cancel: async (_u, id) => void log.push(`cancel:${id}`),
    outcomes: async () => [],
  };
  const d = {
    bridge: { port },
    uow: { tenant: <T>(_w: unknown, fn: (r: null) => Promise<T>) => fn(null) },
    warn: () => {},
  };
  const hooks = {
    check: async () => check,
    attach: async () => {
      if (attach instanceof Error) throw attach;
      log.push(`attach:${attach}`);
      return attach;
    },
  };
  return { log, run: () => startPackRun(d, U, REQ, hooks) };
}

describe("N2-FR-01 · startPackRun", () => {
  test("ok ⇒ start → attach → kick", async () => {
    const h = harness("ok", true);
    expect(await h.run()).toEqual({ kind: "ok", runId: "r1" });
    expect(h.log).toEqual(["start", "attach:true", "kick"]);
  });
  test("bản ghi không thấy / đã có run ⇒ không mở run", async () => {
    for (const c of ["not_found", "has_run"] as const) {
      const h = harness(c, true);
      expect(await h.run()).toEqual({ kind: c });
      expect(h.log).toEqual([]);
    }
  });
  test("gắn thua đua ⇒ huỷ bù, has_run, không kick; gắn lỗi ⇒ huỷ bù rồi ném", async () => {
    const lost = harness("ok", false);
    expect(await lost.run()).toEqual({ kind: "has_run" });
    expect(lost.log).toEqual(["start", "attach:false", "cancel:r1"]);
    const err = harness("ok", new Error("db"));
    await expect(err.run()).rejects.toThrow("db");
    expect(err.log).toEqual(["start", "cancel:r1"]);
  });
  test("engine tắt ⇒ engine_off", async () => {
    const r = await startPackRun(
      { bridge: {}, uow: { tenant: async () => "ok" as never }, warn: () => {} },
      U,
      REQ,
      { check: async () => "ok", attach: async () => true },
    );
    expect(r).toEqual({ kind: "engine_off" });
  });
});
