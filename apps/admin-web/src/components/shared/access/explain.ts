// ADM-FR-36 · M3-R11, R12 · dựng "lý do" từ kết quả effective-access (hàm thuần, không dịch chuỗi: trả key i18n + tham số).
// Dùng chung cho Phân quyền › Kiểm tra quyền và tab Quyền hiệu lực của drawer user. Mã lạ → `access.reason.unknown`.
import type {
  AccessReason,
  EffectiveCommand,
  EffectiveFeature,
  FeatureMini,
  GrantFeatureRef,
} from "@ai/contracts";
import { type LocalizedText, pickLocalized } from "@/lib/localized";
import { foldKeyInput } from "@/lib/normalize";

export type ReasonAction =
  | { kind: "grant"; feature: FeatureMini }
  | { kind: "beta" }
  | { kind: "open"; featureId: string };
export type Reason = { key: string; params: Record<string, string>; action?: ReasonAction };
export type ExplainCtx = { lang: string; username: string };

const nameOf = (f: { name: LocalizedText }, ctx: ExplainCtx) => pickLocalized(f.name, ctx.lang);
const reason = (
  key: string,
  params: Record<string, string> = {},
  action?: ReasonAction,
): Reason => ({
  key,
  params,
  action,
});

/** Lý do một feature HIỆU LỰC (core / qua group / trực tiếp / beta). */
export function grantedLines(reasons: AccessReason[], ctx: ExplainCtx): Reason[] {
  return reasons.map((r) => {
    if (r.code === "core") return reason("users.access.core");
    if (r.code === "grant_user") return reason("access.reason.grantUser");
    if (r.code === "beta_member") return reason("access.reason.betaMember");
    if (r.code === "grant_group") {
      return reason("access.reason.grantGroup", { group: pickLocalized(r.group.name, ctx.lang) });
    }
    return reason("access.reason.unknown");
  });
}

const USER_LEVEL: Record<string, string> = {
  user_inactive: "access.reason.userInactive",
  tenant_locked: "access.reason.tenantLocked",
  command_disabled: "access.reason.commandDisabled",
  workflow_disabled: "access.reason.workflowDisabled",
  no_effective_feature: "access.reason.noEffectiveFeature",
};

/** Vì sao MỘT feature không dùng được (kèm hành động gợi ý theo mã). */
export function featureProblem(
  code: string,
  feature: FeatureMini | GrantFeatureRef,
  ctx: ExplainCtx,
): Reason {
  const p = { feature: nameOf(feature, ctx), user: ctx.username };
  const mini: FeatureMini = { id: feature.id, key: feature.key, name: feature.name };
  if (code === "feature_off") return reason("access.reason.featureOff", p);
  if (code === "beta_not_member") return reason("access.reason.betaNotMember", p, { kind: "beta" });
  if (code === "no_entitlement") {
    return reason("access.reason.noEntitlement", p, { kind: "open", featureId: feature.id });
  }
  if (code === "no_grant")
    return reason("access.reason.noGrant", p, { kind: "grant", feature: mini });
  return reason(USER_LEVEL[code] ?? "access.reason.unknown", p);
}

export function unusableFeatureLines(f: EffectiveFeature, ctx: ExplainCtx): Reason[] {
  return f.missing.map((code) => featureProblem(code, f.feature, ctx));
}

/** Command thấy được: "qua feature F · group G" (hoặc core/beta/trực tiếp) cho từng feature đưa lệnh vào menu. */
export function visibleLines(c: EffectiveCommand, ctx: ExplainCtx): Reason[] {
  return c.via.map((v) => {
    const feature = nameOf(v.feature, ctx);
    const group = v.reasons.find((r) => r.code === "grant_group");
    if (group?.code === "grant_group") {
      return reason("access.reason.viaFeatureGroup", {
        feature,
        group: pickLocalized(group.group.name, ctx.lang),
      });
    }
    if (v.reasons.some((r) => r.code === "core")) return reason("users.access.core");
    if (v.reasons.some((r) => r.code === "beta_member")) return reason("access.reason.betaMember");
    return reason("access.reason.viaFeature", { feature });
  });
}

/** Vì sao một command KHÔNG thấy: từng feature chặn (`blocked_by`) + lý do ở cấp command/người dùng. */
export function hiddenLines(c: EffectiveCommand, ctx: ExplainCtx): Reason[] {
  const blocked = c.blocked_by.flatMap((b) =>
    b.missing.map((code) => featureProblem(code, b.feature, ctx)),
  );
  const own = c.missing
    .filter((code) => code !== "no_effective_feature" || blocked.length === 0)
    .map((code) => featureProblemFor(code, ctx))
    .filter((r): r is Reason => r !== null);
  return [...blocked, ...own];
}

function featureProblemFor(code: string, ctx: ExplainCtx): Reason | null {
  const key = USER_LEVEL[code];
  return key ? reason(key, { user: ctx.username }) : null;
}

/** Lọc command theo ô "Tìm command": không phân biệt hoa thường/dấu, bỏ `/` đầu, khớp tên, alias, mô tả. */
export function filterCommands(commands: EffectiveCommand[], query: string): EffectiveCommand[] {
  const q = foldKeyInput(query.trim().replace(/^\/+/, ""));
  if (q === "") return commands;
  return commands.filter((c) =>
    foldKeyInput(
      [c.name, ...c.aliases, c.description.vi, c.description.en ?? ""].join(" "),
    ).includes(q),
  );
}
