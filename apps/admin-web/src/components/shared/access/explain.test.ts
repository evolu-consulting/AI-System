// ADM-FR-36 · M3-R11, R12 · explain.ts: lý do hiệu lực/không hiệu lực, hành động gợi ý, lọc command.
import { describe, expect, test } from "bun:test";
import type { EffectiveCommand, EffectiveFeature, FeatureMini } from "@ai/contracts";
import {
  featureProblem,
  filterCommands,
  grantedLines,
  hiddenLines,
  unusableFeatureLines,
  visibleLines,
} from "./explain";

const ctx = { lang: "vi", username: "an" };
const kt: FeatureMini = { id: "f1", key: "ke-toan", name: { vi: "Kế toán" } };
const group = { id: "g1", key: "ke-toan", name: { vi: "Kế toán" }, is_beta: false };
const cmd = (over: Partial<EffectiveCommand>): EffectiveCommand => ({
  id: "c1",
  name: "kiemtra-hoadon",
  aliases: ["kt"],
  description: { vi: "Kiểm tra hoá đơn" },
  visible: false,
  via: [],
  blocked_by: [],
  missing: [],
  suggestion: null,
  ...over,
});

describe("ADM-FR-36 · lý do hiệu lực", () => {
  test("grantedLines: core, qua group, beta, trực tiếp", () => {
    const lines = grantedLines(
      [
        { code: "core" },
        { code: "grant_group", group },
        { code: "beta_member" },
        { code: "grant_user" },
      ],
      ctx,
    );
    expect(lines.map((l) => l.key)).toEqual([
      "users.access.core",
      "access.reason.grantGroup",
      "access.reason.betaMember",
      "access.reason.grantUser",
    ]);
    expect(lines[1]?.params).toEqual({ group: "Kế toán" });
  });

  test("visibleLines: qua feature · group; core; beta", () => {
    const c = cmd({
      visible: true,
      via: [
        { feature: kt, reasons: [{ code: "grant_group", group }] },
        { feature: { ...kt, id: "f0", name: { vi: "core" } }, reasons: [{ code: "core" }] },
      ],
    });
    const lines = visibleLines(c, ctx);
    expect(lines[0]).toMatchObject({
      key: "access.reason.viaFeatureGroup",
      params: { feature: "Kế toán", group: "Kế toán" },
    });
    expect(lines[1]?.key).toBe("users.access.core");
  });
});

describe("ADM-FR-36 · lý do không hiệu lực + hành động", () => {
  test("featureProblem: no_grant → gợi ý cấp; beta → thêm vào beta; no_entitlement → mở feature", () => {
    expect(featureProblem("no_grant", kt, ctx)).toMatchObject({
      key: "access.reason.noGrant",
      params: { feature: "Kế toán", user: "an" },
      action: { kind: "grant", feature: kt },
    });
    expect(featureProblem("beta_not_member", kt, ctx).action).toEqual({ kind: "beta" });
    expect(featureProblem("no_entitlement", kt, ctx).action).toEqual({
      kind: "open",
      featureId: "f1",
    });
    expect(featureProblem("feature_off", kt, ctx).action).toBeUndefined();
    expect(featureProblem("zzz", kt, ctx).key).toBe("access.reason.unknown");
  });

  test("hiddenLines: blocked_by trước, command_disabled; no_effective_feature chỉ khi không có feature chặn", () => {
    const blocked = cmd({
      blocked_by: [{ feature: kt, missing: ["no_grant"] }],
      missing: ["no_effective_feature"],
      suggestion: { action: "grant_feature", feature: kt },
    });
    expect(hiddenLines(blocked, ctx).map((l) => l.key)).toEqual(["access.reason.noGrant"]);
    const off = cmd({ missing: ["command_disabled", "workflow_disabled"] });
    expect(hiddenLines(off, ctx).map((l) => l.key)).toEqual([
      "access.reason.commandDisabled",
      "access.reason.workflowDisabled",
    ]);
    expect(hiddenLines(cmd({ missing: ["no_effective_feature"] }), ctx)[0]?.key).toBe(
      "access.reason.noEffectiveFeature",
    );
    expect(hiddenLines(cmd({ missing: ["user_inactive"] }), ctx)[0]?.key).toBe(
      "access.reason.userInactive",
    );
  });

  test("unusableFeatureLines theo `missing`", () => {
    const f = {
      feature: { id: "f1", key: "k", name: { vi: "Báo cáo" }, status: "beta", is_core: false },
      effective: false,
      reasons: [],
      missing: ["beta_not_member", "no_grant"],
    } as unknown as EffectiveFeature;
    expect(unusableFeatureLines(f, ctx).map((l) => l.key)).toEqual([
      "access.reason.betaNotMember",
      "access.reason.noGrant",
    ]);
  });
});

describe("ADM-FR-36 · filterCommands", () => {
  const list = [
    cmd({}),
    cmd({ id: "c2", name: "dich", aliases: ["tr"], description: { vi: "Dịch văn bản" } }),
  ];
  test("không dấu '/', không phân biệt dấu/hoa; khớp tên, alias, mô tả", () => {
    expect(filterCommands(list, "kiemtra").map((c) => c.name)).toEqual(["kiemtra-hoadon"]);
    expect(filterCommands(list, "/DICH").map((c) => c.name)).toEqual(["dich"]);
    expect(filterCommands(list, "van ban").map((c) => c.name)).toEqual(["dich"]);
    expect(filterCommands(list, "tr").map((c) => c.name)).toEqual(["kiemtra-hoadon", "dich"]);
    expect(filterCommands(list, "  ").length).toBe(2);
  });
});
