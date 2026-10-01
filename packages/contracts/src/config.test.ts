import { describe, expect, test } from "bun:test";
import {
  CONFIG_CHANNEL,
  CONFIG_ENTITIES,
  ConfigChangedPayloadSchema,
  type ConfigEvent,
  configChangedPayload,
} from "./index";
import { TENANT_ID as T1, USER_ID as T2 } from "./test-fixtures";

describe("ADM-FR-53 · payload config_changed (spec M3 §3, M3-R16)", () => {
  test("kênh và danh sách entity", () => {
    expect(CONFIG_CHANNEL).toBe("config_changed");
    expect(CONFIG_ENTITIES).toContain("batch");
    expect(CONFIG_ENTITIES).toHaveLength(10);
  });

  test("một event một tenant → entity + tenant_id", () => {
    expect(configChangedPayload(5, [{ entity: "group", tenantId: T1 }])).toEqual({
      v: 5,
      entity: "group",
      tenant_id: T1,
    });
  });

  test("event toàn hệ thống (tenantId null) → không có tenant_id", () => {
    expect(configChangedPayload(2, [{ entity: "feature", tenantId: null }])).toEqual({
      v: 2,
      entity: "feature",
    });
  });
});

describe("ADM-FR-53 · payload config_changed: gộp event và biên", () => {
  test("nhiều entity → batch; cùng tenant giữ tenant_id; khác tenant hoặc lẫn null → bỏ", () => {
    const same: ConfigEvent[] = [
      { entity: "group", tenantId: T1 },
      { entity: "grant", tenantId: T1 },
    ];
    expect(configChangedPayload(3, same)).toEqual({ v: 3, entity: "batch", tenant_id: T1 });
    const diff: ConfigEvent[] = [
      { entity: "grant", tenantId: T1 },
      { entity: "grant", tenantId: T2 },
    ];
    expect(configChangedPayload(4, diff)).toEqual({ v: 4, entity: "grant" });
    const mixed: ConfigEvent[] = [
      { entity: "grant", tenantId: T1 },
      { entity: "grant", tenantId: null },
    ];
    expect(configChangedPayload(4, mixed)).toEqual({ v: 4, entity: "grant" });
  });

  test("events rỗng hoặc v < 1 / không nguyên → ném", () => {
    expect(() => configChangedPayload(1, [])).toThrow();
    expect(() => configChangedPayload(0, [{ entity: "user", tenantId: T1 }])).toThrow();
    expect(() => configChangedPayload(1.5, [{ entity: "user", tenantId: T1 }])).toThrow();
  });

  test("schema strict: khoá lạ, v = 0, entity lạ → lỗi; payload hợp lệ ≤ 8.000 byte", () => {
    const ok = configChangedPayload(9, [{ entity: "secret", tenantId: null }]);
    expect(ConfigChangedPayloadSchema.parse(ok)).toEqual(ok);
    expect(new TextEncoder().encode(JSON.stringify(ok)).length).toBeLessThan(8000);
    expect(ConfigChangedPayloadSchema.safeParse({ ...ok, name: "X" }).success).toBe(false);
    expect(ConfigChangedPayloadSchema.safeParse({ v: 0, entity: "user" }).success).toBe(false);
    expect(ConfigChangedPayloadSchema.safeParse({ v: 1, entity: "quota" }).success).toBe(false);
  });
});
