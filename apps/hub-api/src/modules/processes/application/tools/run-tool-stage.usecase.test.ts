// HUB-FR-146 · AC-H44 · D2-05/D2-17 · S12: `settleOf` — byte (không ký tự) > 64 KB ⇒ tool_failed trước JSON.parse; không
// JSON / sai khai báo ⇒ template_invalid; đạt ⇒ .md + fields lọc theo khai báo.
import { describe, expect, it } from "bun:test";
import { settleOf } from "./run-tool-stage.usecase";

const l = { stageName: "T", outputFields: [{ key: "so", type: "number", required: true }] };

describe("settleOf", () => {
  it("HUB-FR-146 · ok ⇒ fields lọc + md", () => {
    const r = settleOf(l, { kind: "ok", text: '{"so":1,"thua":2}' });
    expect(r).toMatchObject({ kind: "ok", fields: { so: 1 } });
  });
  it("HUB-FR-146 · S12 · 'é' × 33000 (< 64 Ki ký tự, > 64 KB) ⇒ tool_failed", () => {
    const text = `{"so":1,"x":"${"é".repeat(33_000)}"}`;
    expect(settleOf(l, { kind: "ok", text })).toEqual({ kind: "decide", reason: "tool_failed" });
  });
  it("HUB-FR-146 · D2-05 · không JSON / thiếu required ⇒ template_invalid; lỗi gọi ⇒ tool_failed", () => {
    expect(settleOf(l, { kind: "ok", text: "x" })).toEqual({
      kind: "decide",
      reason: "template_invalid",
    });
    expect(settleOf(l, { kind: "ok", text: "{}" })).toEqual({
      kind: "decide",
      reason: "template_invalid",
    });
    const f = { kind: "failed" as const, code: "TIMEOUT", httpStatus: null, sent: true };
    expect(settleOf(l, f)).toEqual({ kind: "decide", reason: "tool_failed" });
  });
});
