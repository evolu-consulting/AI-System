// CR-107 · eng-card-ui: lý do attention ⇒ khoá i18n + nút theo quyền.
import { describe, expect, test } from "bun:test";
import { attentionActions, attentionText } from "./attention";

const B = "contracts.approval.engine.attention.reason";

describe("attentionText", () => {
  test("needs_decision: mã biết ⇒ khoá riêng; mã lạ/null ⇒ other", () => {
    expect(attentionText({ kind: "needs_decision", reason: "tool_failed" }).key).toBe(
      `${B}.tool_failed`,
    );
    expect(attentionText({ kind: "needs_decision", reason: "retry_exhausted" }).key).toBe(
      `${B}.retry_exhausted`,
    );
    expect(attentionText({ kind: "needs_decision", reason: "zzz" }).key).toBe(`${B}.other`);
    expect(attentionText({ kind: "needs_decision", reason: null }).key).toBe(`${B}.other`);
  });
  test("stalled FLOW_GROUP_MISSING:<mã,…> ⇒ nêu mã phòng ban", () => {
    expect(
      attentionText({ kind: "stalled", reason: "FLOW_GROUP_MISSING:phap-che, ke-toan" }),
    ).toEqual({
      key: `${B}.FLOW_GROUP_MISSING`,
      vars: { keys: "phap-che, ke-toan" },
    });
    expect(attentionText({ kind: "stalled", reason: "FLOW_GROUP_MISSING" }).key).toBe(
      `${B}.FLOW_GROUP_MISSING_ANY`,
    );
  });
  test("stalled: FLOW_INVALID / FLOW_MISSING / CANCELLED_BY_OWNER / ENGINE_RUN_* / null", () => {
    expect(attentionText({ kind: "stalled", reason: "FLOW_INVALID" }).key).toBe(
      `${B}.FLOW_INVALID`,
    );
    expect(attentionText({ kind: "stalled", reason: "FLOW_MISSING" }).key).toBe(
      `${B}.FLOW_MISSING`,
    );
    expect(attentionText({ kind: "stalled", reason: "CANCELLED_BY_OWNER" }).key).toBe(
      `${B}.CANCELLED_BY_OWNER`,
    );
    expect(attentionText({ kind: "stalled", reason: "ENGINE_RUN_FAILED" }).key).toBe(
      "contracts.approval.engine.release.FAILED",
    );
    expect(attentionText({ kind: "stalled", reason: null }).key).toBe(
      "contracts.approval.engine.release.OTHER",
    );
  });
});

describe("attentionActions", () => {
  test("owner: needs_decision có Thử lại + Huỷ & mở lại; stalled có Mở lại", () => {
    expect(attentionActions({ kind: "needs_decision" }, true)).toEqual({
      retry: true,
      cancelReopen: true,
      reopen: false,
      tellOwner: false,
    });
    expect(attentionActions({ kind: "stalled" }, true).reopen).toBe(true);
  });
  test("không phải owner: không nút, có câu báo chủ hợp đồng", () => {
    expect(attentionActions({ kind: "needs_decision" }, false)).toEqual({
      retry: false,
      cancelReopen: false,
      reopen: false,
      tellOwner: true,
    });
  });
});
