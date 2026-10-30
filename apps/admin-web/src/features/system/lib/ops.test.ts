// CR-104 · ops-ui · unit hàm thuần: trạng thái tổng, lệnh trong gợi ý, kiểm cấu hình (khớp contract), lỗi 422, gói chẩn đoán.
import { describe, expect, test } from "bun:test";
import {
  OPS_CHECK_KEYS,
  OPS_DEFAULT_SETTINGS,
  type OpsCheckRow,
  type OpsEvent,
  type OpsSettings,
  OpsSettingsSchema,
} from "@ai/contracts/hub-admin";
import {
  buildDiagnosticText,
  extractCommand,
  nextDueAt,
  overallStatus,
  serverErrors,
  validateSettings,
} from "./ops";

const row = (check_key: string, status: OpsCheckRow["status"], extra: Partial<OpsCheckRow> = {}) =>
  ({
    check_key,
    status,
    value: null,
    message: `${check_key} ${status}`,
    hint: null,
    checked_at: "2026-10-30T07:00:00.000Z",
    changed_at: "2026-10-30T06:00:00.000Z",
    ...extra,
  }) satisfies OpsCheckRow;

const withCheck = (key: keyof OpsSettings["checks"], v: object): OpsSettings => ({
  ...OPS_DEFAULT_SETTINGS,
  checks: { ...OPS_DEFAULT_SETTINGS.checks, [key]: { ...OPS_DEFAULT_SETTINGS.checks[key], ...v } },
});

describe("overallStatus", () => {
  test("xấu nhất thắng; check tắt bị bỏ qua; rỗng ⇒ unknown", () => {
    const s = OPS_DEFAULT_SETTINGS;
    expect(overallStatus([], s)).toBe("unknown");
    const all = (over: Record<string, OpsCheckRow["status"]> = {}) =>
      OPS_CHECK_KEYS.map((k) => row(k, over[k] ?? "ok"));
    expect(overallStatus(all(), s)).toBe("ok");
    expect(overallStatus(all({ tls: "warn" }), s)).toBe("warn");
    expect(overallStatus(all({ disk: "warn", tls: "crit" }), s)).toBe("crit");
    expect(overallStatus(all({ tls: "unknown" }), s)).toBe("unknown");
    expect(overallStatus([row("disk", "ok")], s)).toBe("unknown"); // thiếu dòng các check còn lại
    expect(overallStatus(all({ tls: "crit" }), withCheck("tls", { enabled: false }))).toBe("ok");
  });
});

describe("nextDueAt / extractCommand", () => {
  test("hạn kế = lượt cuối + tần suất", () => {
    expect(nextDueAt(null, 30)).toBeNull();
    expect(nextDueAt("2026-10-30T07:00:00.000Z", 30)?.toISOString()).toBe(
      "2026-10-30T07:30:00.000Z",
    );
  });
  test("lấy lệnh trong dấu huyền hoặc dòng `$ `", () => {
    expect(extractCommand("Đăng nhập lại: `claude /login` rồi thử")).toBe("claude /login");
    expect(extractCommand("Chạy\n$ df -h")).toBe("df -h");
    expect(extractCommand("Kiểm tra mạng")).toBeNull();
    expect(extractCommand(null)).toBeNull();
  });
});

describe("validateSettings (phản chiếu contract)", () => {
  test("mặc định hợp lệ", () => expect(validateSettings(OPS_DEFAULT_SETTINGS)).toEqual({}));
  test("tần suất ngoài 5–1440, rỗng, không nguyên", () => {
    expect(validateSettings({ ...OPS_DEFAULT_SETTINGS, every_min: 4 }).every_min?.code).toBe(
      "range",
    );
    expect(validateSettings({ ...OPS_DEFAULT_SETTINGS, every_min: 1441 }).every_min?.code).toBe(
      "range",
    );
    expect(
      validateSettings({ ...OPS_DEFAULT_SETTINGS, every_min: null as never }).every_min?.code,
    ).toBe("required");
    expect(validateSettings({ ...OPS_DEFAULT_SETTINGS, every_min: 7.5 }).every_min?.code).toBe(
      "int",
    );
  });
  test("thứ tự warn/crit theo meta; null level không có ô", () => {
    expect(validateSettings(withCheck("disk", { warn: 95, crit: 90 }))["disk.crit"]).toEqual({
      code: "order",
      order: "asc",
    });
    expect(validateSettings(withCheck("tls", { warn: 2, crit: 3 }))["tls.crit"]).toEqual({
      code: "order",
      order: "desc",
    });
    expect(validateSettings(withCheck("tls", { warn: 30, crit: 7 }))).toEqual({});
    expect(validateSettings(withCheck("disk", { warn: 120 }))["disk.warn"]?.code).toBe("range");
    expect(validateSettings(withCheck("db_redis", { warn: null, crit: null }))).toEqual({});
  });
  test("cùng kết luận với OpsSettingsSchema", () => {
    for (const s of [
      OPS_DEFAULT_SETTINGS,
      withCheck("disk", { warn: 95, crit: 90 }),
      withCheck("tls", { warn: 2, crit: 3 }),
      withCheck("disk", { crit: 101 }),
      { ...OPS_DEFAULT_SETTINGS, every_min: 3 },
    ])
      expect(Object.keys(validateSettings(s)).length === 0).toBe(
        OpsSettingsSchema.safeParse(s).success,
      );
  });
});

describe("serverErrors", () => {
  test("422 issues → khoá theo ô", () => {
    const e = serverErrors({
      issues: [
        { path: ["checks", "disk", "crit"], message: "x" },
        { path: ["every_min"], message: "y" },
      ],
    });
    expect(e["disk.crit"]).toEqual({ code: "server", message: "x" });
    expect(e.every_min?.code).toBe("server");
    expect(serverErrors(undefined)).toEqual({});
  });
});

describe("buildDiagnosticText", () => {
  const text = {
    title: "GÓI",
    time: "Thời điểm",
    env: "Môi trường",
    deploy: "Bản deploy",
    checks: "Các check",
    disabled: "Đã tắt",
    events: "Sự kiện",
    noEvents: "Không có",
    settingsChanged: (u: string) => `Đổi cấu hình bởi ${u}`,
  };
  const ev = (id: number, over: Partial<OpsEvent> = {}): OpsEvent => ({
    id,
    check_key: "disk",
    from_status: "ok",
    to_status: "warn",
    kind: "status",
    actor_user_id: null,
    detail: null,
    at: "2026-10-30T07:00:00.000Z",
    ...over,
  });
  const base = {
    now: new Date("2026-10-30T08:00:00.000Z"),
    settings: withCheck("tls", { enabled: false }),
    labelOf: (k: string) => `L:${k}`,
    actorOf: () => "Admin",
    text,
  };

  test("có giờ, env, deploy, mọi check, check tắt, tối đa 20 sự kiện", () => {
    const out = buildDiagnosticText({
      ...base,
      env: "https://ai-admin.test",
      rows: [
        row("disk", "warn", {
          value: { used: 85, version: "v1.2.3" },
          hint: "dọn `docker system prune`",
        }),
        row("provider", "crit"),
      ],
      events: [
        ...Array.from({ length: 25 }, (_, i) => ev(i)),
        ev(99, {
          kind: "settings_changed",
          check_key: null,
          from_status: null,
          to_status: null,
          actor_user_id: "u",
        }),
      ],
    });
    expect(out).toContain("2026-10-30T08:00:00.000Z");
    expect(out).toContain("Môi trường: https://ai-admin.test");
    expect(out).toContain("Bản deploy: v1.2.3");
    expect(out).toContain("- L:disk: WARN — disk warn");
    expect(out).toContain("- L:provider: CRIT");
    expect(out).toContain("- L:tls: Đã tắt");
    expect(out).toContain("> dọn `docker system prune`");
    expect(out.split("\n").filter((l) => l.includes("L:disk: ok → warn"))).toHaveLength(20);
    expect(out).not.toContain("Đổi cấu hình bởi"); // sự kiện thứ 26 vượt giới hạn 20
  });

  test("không env/deploy ⇒ bỏ dòng; không sự kiện ⇒ ghi rõ", () => {
    const out = buildDiagnosticText({ ...base, rows: [row("disk", "ok")], events: [] });
    expect(out).not.toContain("Môi trường");
    expect(out).not.toContain("Bản deploy");
    expect(out).toContain("- Không có");
  });
});
