// CR-104 · ops-core · unit contract cấu hình ops-watch: mặc định hợp lệ, khoảng tần suất/ngưỡng, thứ tự warn/crit, gộp mặc định.
import { describe, expect, it } from "bun:test";
import { OPS_DEFAULT_SETTINGS, OpsSettingsSchema, opsSettingsFrom } from "./ops";

const withCheck = (key: keyof typeof OPS_DEFAULT_SETTINGS.checks, v: object) => ({
  ...OPS_DEFAULT_SETTINGS,
  checks: { ...OPS_DEFAULT_SETTINGS.checks, [key]: { ...OPS_DEFAULT_SETTINGS.checks[key], ...v } },
});

describe("ops-watch · OpsSettingsSchema", () => {
  it("mặc định hợp lệ: 30 phút, 8 check bật", () => {
    expect(OpsSettingsSchema.safeParse(OPS_DEFAULT_SETTINGS).success).toBe(true);
    expect(OPS_DEFAULT_SETTINGS.every_min).toBe(30);
    expect(Object.values(OPS_DEFAULT_SETTINGS.checks).every((c) => c.enabled)).toBe(true);
  });

  it("tần suất ngoài 5–1440 bị từ chối", () => {
    for (const every_min of [4, 1441, 7.5])
      expect(OpsSettingsSchema.safeParse({ ...OPS_DEFAULT_SETTINGS, every_min }).success).toBe(
        false,
      );
  });

  it("ngưỡng ngoài khoảng, ngưỡng cho mức không dùng, thứ tự warn/crit sai ⇒ từ chối", () => {
    expect(OpsSettingsSchema.safeParse(withCheck("disk", { warn: 101 })).success).toBe(false);
    expect(OpsSettingsSchema.safeParse(withCheck("db_redis", { crit: 1 })).success).toBe(false);
    expect(OpsSettingsSchema.safeParse(withCheck("disk", { warn: 95, crit: 90 })).success).toBe(
      false,
    );
    expect(OpsSettingsSchema.safeParse(withCheck("tls", { warn: 2, crit: 3 })).success).toBe(false);
    expect(OpsSettingsSchema.safeParse(withCheck("tls", { warn: 30, crit: 7 })).success).toBe(true);
  });

  it("thiếu check hoặc khoá lạ ⇒ từ chối", () => {
    const { disk: _d, ...rest } = OPS_DEFAULT_SETTINGS.checks;
    expect(OpsSettingsSchema.safeParse({ every_min: 30, checks: rest }).success).toBe(false);
    expect(OpsSettingsSchema.safeParse({ ...OPS_DEFAULT_SETTINGS, x: 1 }).success).toBe(false);
  });

  it("opsSettingsFrom: thiếu khoá ⇒ mặc định từng check; bản lưu hỏng ⇒ mặc định", () => {
    const s = opsSettingsFrom({
      every_min: 10,
      checks: { disk: { enabled: false, warn: 70, crit: 85 } },
    });
    expect(s.every_min).toBe(10);
    expect(s.checks.disk).toEqual({ enabled: false, warn: 70, crit: 85 });
    expect(s.checks.tls).toEqual(OPS_DEFAULT_SETTINGS.checks.tls);
    expect(opsSettingsFrom({ every_min: 1 })).toEqual(OPS_DEFAULT_SETTINGS);
    expect(opsSettingsFrom(null)).toEqual(OPS_DEFAULT_SETTINGS);
  });
});
