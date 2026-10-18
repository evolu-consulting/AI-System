// ADM-FR-73 · PD2-U20 · toggleChange / isOnAfter (plan-d2 §6).
import { describe, expect, it } from "bun:test";
import { isOnAfter, toggleChange } from "./tool-switch.rules";

const R = { revokedAt: new Date("2026-10-01T00:00:00Z") };
const A = { revokedAt: null };

describe("ADM-FR-73 · toggleChange", () => {
  it("ADM-FR-73 · bảng 6 ca (hàng: vắng/đã tắt/đang bật × muốn on/off)", () => {
    expect([
      toggleChange(null, "on"),
      toggleChange(R, "on"),
      toggleChange(A, "on"),
      toggleChange(A, "off"),
      toggleChange(R, "off"),
      toggleChange(null, "off"),
    ]).toEqual(["insert", "reactivate", "none", "revoke", "none", "none"]);
  });
  it("ADM-FR-73 · isOnAfter: ghi ⇒ theo việc; none ⇒ giữ trạng thái hiện tại", () => {
    expect([
      isOnAfter(null, "insert"),
      isOnAfter(R, "reactivate"),
      isOnAfter(A, "revoke"),
      isOnAfter(A, "none"),
      isOnAfter(R, "none"),
      isOnAfter(null, "none"),
    ]).toEqual([true, true, false, true, false, false]);
  });
});
