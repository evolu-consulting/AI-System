// CR-123 · FLOW3-FR-14 · kéo / nối lại đầu ra của ô node module (Ký số): đặt nhánh của stage CHỜ, luật đích như nối thường.
import { describe, expect, test } from "bun:test";
import { type ConnectStage, connectPatch, exitHandle } from "./canvas-connect";

const st = (uid: string, step: number, o: Partial<ConnectStage> = {}): ConnectStage => ({
  uid,
  step,
  executor: "agent",
  real: false,
  ifx: { yes: null, no: null },
  ...o,
});
const wait = {
  source: "",
  offset: "0",
  time: "09:00",
  event: "esign.completed",
  branches: [
    { on: "esign.declined", step: 6 },
    { on: "timeout", step: 6 },
  ],
};
/** 0 Duyệt · 1 Ký số (gửi) · 2 Ký số (chờ) · 3 Thông báo · 4 Kết thúc Đã duyệt · 5 Kết thúc Từ chối. */
const flow = [
  st("a", 0),
  st("send", 1, { node: "contracts.esign", executor: "tool", real: true }),
  st("wait", 2, { node: "contracts.esign", executor: "wait_event", wait }),
  st("n", 3),
  st("ok", 4, { outcome: "approved" }),
  st("no", 5, { outcome: "rejected" }),
];
const DECLINED = exitHandle("declined", ["esign.declined", "esign.voided"]);
const EXPIRED = exitHandle("expired", ["timeout"]);

describe("connectPatch · đầu ra ô module", () => {
  test("Từ chối ⇒ declined + voided của stage chờ tới đích, giữ nhánh khác", () => {
    const r = connectPatch(flow, { source: "send", target: "no", sourceHandle: DECLINED });
    expect(r).toMatchObject({ ok: true, index: 2, field: "exit" });
    if (r?.ok) {
      const w = r.patch.wait as typeof wait;
      expect(w.branches).toEqual([
        { on: "timeout", step: 6 },
        { on: "esign.declined", step: 5 },
        { on: "esign.voided", step: 5 },
      ]);
      expect(w.event).toBe("esign.completed"); // phần còn lại của khối chờ giữ nguyên
    }
  });
  test("Hết hạn ⇒ chỉ nhánh timeout", () => {
    const r = connectPatch(flow, { source: "send", target: "n", sourceHandle: EXPIRED });
    if (!r?.ok) throw new Error("phải hợp lệ");
    expect((r.patch.wait as typeof wait).branches).toEqual([
      { on: "esign.declined", step: 6 },
      { on: "timeout", step: 3 },
    ]);
  });
  test("Ký xong (và cạnh tiến thường ra khỏi ô) ⇒ nextStep của stage chờ; bước kế = mặc định", () => {
    const done = connectPatch(flow, { source: "send", target: "ok", sourceHandle: "exit:done" });
    expect(done).toMatchObject({ ok: true, index: 2, field: "next", patch: { nextStep: 4 } });
    const plain = connectPatch(flow, { source: "send", target: "n", sourceHandle: null });
    expect(plain).toMatchObject({ ok: true, index: 2, patch: { nextStep: undefined } });
  });
  test("đích không sau stage chờ ⇒ notLater (không tính stage gửi); luật real_action của Nếu không áp", () => {
    expect(
      connectPatch(flow, { source: "send", target: "wait", sourceHandle: DECLINED }),
    ).toMatchObject({ ok: false, error: "notLater" });
    const real = [...flow.slice(0, 5), st("no", 5, { outcome: "rejected", real: true })];
    expect(
      connectPatch(real, { source: "send", target: "no", sourceHandle: DECLINED }),
    ).toMatchObject({
      ok: true,
    });
  });
  test("nối lại: cùng đường với kéo cổng (đổi đích của Từ chối)", () => {
    const r = connectPatch(flow, { source: "send", target: "n", sourceHandle: DECLINED });
    expect(r).toMatchObject({ ok: true, field: "exit" });
  });
});
