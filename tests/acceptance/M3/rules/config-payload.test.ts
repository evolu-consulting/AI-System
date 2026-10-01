// ADM-FR-53 · payload NOTIFY `config_changed` (spec M3 §3 "NOTIFY", M3-R16; test-plan R2). Hàm thuần của contract.
import { describe, expect, it } from "bun:test";
import {
  CONFIG_PAYLOAD_MAX_BYTES,
  ConfigChangedPayloadSchema,
  type ConfigEvent,
  configChangedPayload,
} from "@ai/contracts";

const T1 = "01900000-0000-7000-8000-000000000001";
const T2 = "01900000-0000-7000-8000-000000000002";
const ev = (entity: ConfigEvent["entity"], tenantId: string | null): ConfigEvent => ({
  entity,
  tenantId,
});

describe("ADM-FR-53 · configChangedPayload (M3-R16)", () => {
  it("ADM-FR-53 · M3-R16 · một sự kiện có tenant → {v, entity, tenant_id}", () => {
    expect(configChangedPayload(5, [ev("group", T1)])).toEqual({
      v: 5,
      entity: "group",
      tenant_id: T1,
    });
  });

  it("ADM-FR-53 · M3-R16 · nhiều sự kiện cùng entity cùng tenant → entity đó + tenant_id", () => {
    expect(configChangedPayload(7, [ev("grant", T1), ev("grant", T1)])).toEqual({
      v: 7,
      entity: "grant",
      tenant_id: T1,
    });
  });

  it("ADM-FR-53 · M3-R16 · khác entity → entity 'batch'", () => {
    const p = configChangedPayload(8, [ev("grant", T1), ev("group", T1)]);
    expect(p.entity).toBe("batch");
    expect(p.tenant_id).toBe(T1);
  });

  it("ADM-FR-53 · M3-R16 · cùng entity khác tenant → KHÔNG có tenant_id", () => {
    const p = configChangedPayload(9, [ev("user", T1), ev("user", T2)]);
    expect(p).toEqual({ v: 9, entity: "user" });
    expect("tenant_id" in p).toBe(false);
  });

  it("ADM-FR-53 · M3-R16 · sự kiện toàn hệ thống (tenantId null: catalog, secret) → không tenant_id", () => {
    expect(configChangedPayload(3, [ev("secret", null)])).toEqual({ v: 3, entity: "secret" });
    expect(configChangedPayload(3, [ev("feature", null)])).toEqual({ v: 3, entity: "feature" });
  });

  it("ADM-FR-53 · M3-R16 · lẫn tenantId null và id → không tenant_id", () => {
    const p = configChangedPayload(4, [ev("entitlement", T1), ev("entitlement", null)]);
    expect(p).toEqual({ v: 4, entity: "entitlement" });
  });

  it("ADM-FR-53 · M3-R16 · events rỗng → ném Error (transaction không đổi gì thì không được gọi)", () => {
    expect(() => configChangedPayload(1, [])).toThrow();
  });

  it("ADM-FR-53 · M3-R16 · kết quả qua ConfigChangedPayloadSchema strict: v 0 / 1,5 fail; khoá lạ (name, username) fail", () => {
    const good = configChangedPayload(2, [ev("tenant", T1)]);
    expect(ConfigChangedPayloadSchema.safeParse(good).success).toBe(true);
    expect(ConfigChangedPayloadSchema.safeParse({ v: 0, entity: "tenant" }).success).toBe(false);
    expect(ConfigChangedPayloadSchema.safeParse({ v: 1.5, entity: "tenant" }).success).toBe(false);
    expect(ConfigChangedPayloadSchema.safeParse({ ...good, name: "acme" }).success).toBe(false);
    expect(ConfigChangedPayloadSchema.safeParse({ ...good, username: "lan" }).success).toBe(false);
    expect(ConfigChangedPayloadSchema.safeParse({ v: 1, entity: "weird" }).success).toBe(false);
  });

  it("ADM-FR-53 · M3-R16 · payload hợp lệ ≤ 8.000 byte và chỉ có khoá v, entity, tenant_id", () => {
    const p = configChangedPayload(2_000_000_000, [ev("group", T1)]);
    expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThanOrEqual(CONFIG_PAYLOAD_MAX_BYTES);
    expect(Object.keys(p).sort()).toEqual(["entity", "tenant_id", "v"]);
  });
});
