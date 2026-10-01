import { describe, expect, test } from "bun:test";
import {
  type Grant,
  GrantBatchRequestSchema,
  GrantCreateRequestSchema,
  GrantDeleteQuerySchema,
  type GrantMatrix,
  GrantMatrixQuerySchema,
  GrantMatrixSchema,
  GrantSchema,
  InvalidReferenceDetailsSchema,
  NotEntitledDetailsSchema,
} from "./index";
import { TENANT_ID as F, USER_ID as G, T0 } from "./test-fixtures";

const feature = {
  id: F,
  key: "ke-toan",
  name: { vi: "Kế toán" },
  status: "on",
  is_core: false,
} as const;
const ref = { id: G, key: "ke-toan", name: { vi: "Kế toán" }, is_beta: false };
const key = (i: number) => ({
  feature_id: F,
  group_id: `0199a3b2-7c1e-7a2b-8c3d-${String(i).padStart(12, "0")}`,
});

describe("ADM-FR-32 · Grant (spec M3 §3)", () => {
  test("Grant với subject group hoặc user", () => {
    const g: Grant = {
      id: G,
      tenant_id: F,
      feature,
      subject: { type: "group", group: ref },
      entitled: true,
      granted_at: T0,
      granted_by: null,
    };
    expect(GrantSchema.parse(g)).toEqual(g);
    const u: Grant = {
      ...g,
      subject: { type: "user", user: { id: G, username: "an", display_name: "An" } },
    };
    expect(GrantSchema.parse(u)).toEqual(u);
    expect(GrantSchema.safeParse({ ...g, subject: { type: "role" } }).success).toBe(false);
  });

  test("POST/DELETE: đúng một trong group_id/user_id", () => {
    expect(GrantCreateRequestSchema.safeParse({ feature_id: F, group_id: G }).success).toBe(true);
    expect(GrantCreateRequestSchema.safeParse({ feature_id: F, user_id: G }).success).toBe(true);
    expect(GrantCreateRequestSchema.safeParse({ feature_id: F }).success).toBe(false);
    expect(
      GrantCreateRequestSchema.safeParse({ feature_id: F, group_id: G, user_id: G }).success,
    ).toBe(false);
    expect(
      GrantDeleteQuerySchema.safeParse({ feature_id: F, group_id: G, tenant_id: F }).success,
    ).toBe(true);
    expect(GrantDeleteQuerySchema.safeParse({ feature_id: F }).success).toBe(false);
  });

  test("details: NOT_ENTITLED {feature_ids ≥ 1}; INVALID_REFERENCE nhận field M3", () => {
    expect(NotEntitledDetailsSchema.safeParse({ feature_ids: [F] }).success).toBe(true);
    expect(NotEntitledDetailsSchema.safeParse({ feature_ids: [] }).success).toBe(false);
    for (const field of ["feature_id", "group_id", "user_id", "group_ids", "feature_ids"]) {
      expect(InvalidReferenceDetailsSchema.safeParse({ field, ids: [G] }).success).toBe(true);
    }
  });
});

describe("ADM-FR-35 · batch + ma trận (M3-R08, R09)", () => {
  test("batch: mặc định [], tổng 1–200, trùng cặp (trong hoặc giữa hai mảng) → lỗi", () => {
    expect(GrantBatchRequestSchema.parse({ add: [key(1)] })).toEqual({ add: [key(1)], remove: [] });
    expect(GrantBatchRequestSchema.safeParse({}).success).toBe(false);
    const many = Array.from({ length: 201 }, (_, i) => key(i));
    expect(
      GrantBatchRequestSchema.safeParse({ add: many.slice(0, 100), remove: many.slice(100) })
        .success,
    ).toBe(false);
    expect(GrantBatchRequestSchema.safeParse({ add: many.slice(0, 200) }).success).toBe(true);
    const dupIn = GrantBatchRequestSchema.safeParse({ add: [key(1), key(1)] });
    expect(dupIn.success ? [] : dupIn.error.issues.map((i) => i.path)).toEqual([["add", 1]]);
    const dupX = GrantBatchRequestSchema.safeParse({ add: [key(1)], remove: [key(1)] });
    expect(dupX.success ? [] : dupX.error.issues.map((i) => i.path)).toEqual([["remove", 0]]);
    expect(
      GrantBatchRequestSchema.safeParse({ add: [{ feature_id: F, user_id: G }] }).success,
    ).toBe(false);
  });

  test("matrix query: limit mặc định 200, tối đa 200", () => {
    expect(GrantMatrixQuerySchema.parse({})).toEqual({ limit: 200, offset: 0 });
    expect(GrantMatrixQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
  });

  test("matrix: group có member_count, state enum, command_names ≤ 10", () => {
    const m: GrantMatrix = {
      tenant_id: F,
      groups: [{ ...ref, member_count: 2 }],
      group_total: 1,
      features: [
        {
          feature,
          state: "none",
          command_names: ["kiemtra-hoadon"],
          command_count: 1,
          granted_group_ids: [],
        },
      ],
    };
    expect(GrantMatrixSchema.parse(m)).toEqual(m);
    const bad = { ...m, features: [{ ...m.features[0], state: "hidden" }] };
    expect(GrantMatrixSchema.safeParse(bad).success).toBe(false);
    const names = Array.from({ length: 11 }, (_, i) => `c${i}x`);
    const tooMany = { ...m, features: [{ ...m.features[0], command_names: names }] };
    expect(GrantMatrixSchema.safeParse(tooMany).success).toBe(false);
    const betaWrong = { ...m, groups: [{ ...ref, is_beta: true, member_count: 1 }] };
    expect(GrantMatrixSchema.safeParse(betaWrong).success).toBe(false);
  });
});
