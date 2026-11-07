// CR-125 · m9 · mẫu Thông báo đọc đầu ra các bước trước + đầu ra `sent_to` (luật thuần).
import { describe, expect, test } from "bun:test";
import { notifyFields, notifyVars, renderNotify } from "./notify.rules";

describe("notifyVars (CR-125 m9)", () => {
  test("`{signed_at}` lấy từ đầu ra bước Ký số; bước sau đè bước trước; input thắng khi trùng", () => {
    const vars = notifyVars({ contract_id: "c1", event: "từ-input" }, [
      { decision: "approved", event: "approve" },
      { event: "esign.completed", signed_at: "2026-11-07", round: 2, ok: true, x: null },
    ]);
    expect(vars).toEqual({
      decision: "approved",
      event: "từ-input",
      signed_at: "2026-11-07",
      round: "2",
      ok: "true",
      contract_id: "c1",
    });
    expect(renderNotify("Đã ký ngày {signed_at} ({decision})", vars, 200)).toBe(
      "Đã ký ngày 2026-11-07 (approved)",
    );
  });
  test("sent_to = tên người nhận; không ai ⇒ không có khoá", () => {
    expect(notifyFields("An, Bình")).toEqual({ sent_to: "An, Bình" });
    expect(notifyFields("  ")).toEqual({});
  });
});
