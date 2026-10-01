import { describe, expect, test } from "bun:test";
import {
  type EffectiveAccess,
  EffectiveAccessQuerySchema,
  EffectiveAccessSchema,
  type EffectiveCommand,
  EffectiveCommandSchema,
  type EffectiveFeature,
  EffectiveFeatureSchema,
} from "./index";
import { TENANT_ID as F, USER_ID as U } from "./test-fixtures";

const mini = { id: F, key: "ke-toan", name: { vi: "Kế toán" } };
const feature = { ...mini, status: "on", is_core: false } as const;
const group = { id: U, key: "ke-toan", name: { vi: "Kế toán" }, is_beta: false };

const command: EffectiveCommand = {
  id: U,
  name: "kiemtra-hoadon",
  aliases: [],
  description: { vi: "Kiểm tra hoá đơn" },
  visible: false,
  via: [],
  blocked_by: [{ feature: mini, missing: ["no_grant"] }],
  missing: ["no_effective_feature"],
  suggestion: { action: "grant_feature", feature: mini },
};

describe("ADM-FR-36 · effective-access (spec M3 §3, M3-R11, R12)", () => {
  test("feature: effective ⇔ missing rỗng; reasons có group", () => {
    const ok: EffectiveFeature = {
      feature,
      effective: true,
      reasons: [{ code: "grant_group", group }],
      missing: [],
    };
    expect(EffectiveFeatureSchema.parse(ok)).toEqual(ok);
    expect(EffectiveFeatureSchema.safeParse({ ...ok, missing: ["no_grant"] }).success).toBe(false);
    const kept = { feature, effective: false, reasons: ok.reasons, missing: ["no_entitlement"] };
    expect(EffectiveFeatureSchema.safeParse(kept).success).toBe(true);
    expect(
      EffectiveFeatureSchema.safeParse({ ...kept, missing: ["command_disabled"] }).success,
    ).toBe(false);
  });

  test("command: visible ⇔ missing rỗng; blocked_by không nhận user blocker", () => {
    expect(EffectiveCommandSchema.parse(command)).toEqual(command);
    expect(EffectiveCommandSchema.safeParse({ ...command, visible: true }).success).toBe(false);
    const userBlocker = { ...command, blocked_by: [{ feature: mini, missing: ["user_inactive"] }] };
    expect(EffectiveCommandSchema.safeParse(userBlocker).success).toBe(false);
    const visible = {
      ...command,
      visible: true,
      via: [{ feature: mini, reasons: [{ code: "core" }] }],
      blocked_by: [],
      missing: [],
      suggestion: null,
    };
    expect(EffectiveCommandSchema.safeParse(visible).success).toBe(true);
  });
});

describe("ADM-FR-36 · effective-access response + query", () => {
  test("EffectiveAccess đầy đủ; agents luôn {available:false}", () => {
    const a: EffectiveAccess = {
      user: {
        id: U,
        username: "an",
        display_name: "An",
        tenant_id: F,
        tenant_key: "acme",
        status: "active",
        groups: [group],
      },
      blockers: [],
      features: [],
      commands: [],
      command_total: 0,
      agents: { available: false },
      config_version: 0,
    };
    expect(EffectiveAccessSchema.parse(a)).toEqual(a);
    expect(EffectiveAccessSchema.safeParse({ ...a, agents: { available: true } }).success).toBe(
      false,
    );
  });

  test("?command: trim, lower, bỏ một '/' đầu; sai dạng → lỗi", () => {
    expect(EffectiveAccessQuerySchema.parse({ command: " /KiemTra-HoaDon " })).toEqual({
      command: "kiemtra-hoadon",
    });
    expect(EffectiveAccessQuerySchema.parse({})).toEqual({});
    expect(EffectiveAccessQuerySchema.safeParse({ command: "//x" }).success).toBe(false);
    expect(EffectiveAccessQuerySchema.safeParse({ command: "a" }).success).toBe(false);
  });
});
