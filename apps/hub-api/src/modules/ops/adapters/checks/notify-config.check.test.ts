// CR-121 c21 · unit: đánh giá check `notify_config` (thuần): kho chưa có secret mail ⇒ warn kèm cách sửa; có ⇒ ok.
import { describe, expect, it } from "bun:test";
import { evaluateNotifyConfig } from "./notify-config.check";

describe("notify_config · evaluateNotifyConfig", () => {
  it("0 secret mail ⇒ warn (chưa cấu hình mail), có hint, không lộ giá trị", () => {
    const r = evaluateNotifyConfig(0);
    expect(r.status).toBe("warn");
    expect(r.message).toContain("Chưa cấu hình mail");
    expect(r.hint).toContain("smtp_password");
    expect(r.value).toEqual({ configured: 0 });
  });

  it("có secret mail ⇒ ok", () => {
    const r = evaluateNotifyConfig(1);
    expect(r.status).toBe("ok");
    expect(r.value).toEqual({ configured: 1 });
  });
});
