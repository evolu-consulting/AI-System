// CR-125 · c5 · "mẫu Thư viện dùng được ở công ty chưa": đọc phía công ty (tính năng bật, tool khả dụng, nhóm) rồi gọi MỘT luật thuần
// `templateReadiness` (contracts). Ba câu SQL cố định (tính năng, nhóm, + tool theo `toolSwitchReader`), không phụ thuộc số bước.
import {
  groupKeyCandidates,
  MODULES,
  templateNeeds,
  templateReadiness,
} from "@ai/contracts/modules";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { AppError } from "../../../lib/errors";
import type { PackToolCatalog } from "../../packs/kit/public";
import { toolSwitchReader } from "../adapters/tools/tool-switch.repo";

export type Readiness = ReturnType<typeof templateReadiness>;

async function tenantFeatureKeys(
  tx: Tx,
  tid: string,
  keys: readonly string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await tx.execute<{ key: string }>(sql`select f.key from admin.features f
    join admin.feature_entitlements en on en.feature_id = f.id and en.revoked_at is null and en.tenant_id = ${tid}::uuid
    where f.status <> 'off' and f.key in (select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))`);
  return new Set(rows.map((r) => r.key));
}

export async function tenantGroupKeys(
  tx: Tx,
  tid: string,
  wanted: readonly string[],
): Promise<string[]> {
  if (wanted.length === 0) return [];
  const rows = await tx.execute<{
    key: string;
  }>(sql`select key from admin.groups where tenant_id = ${tid}::uuid
    and key in (select jsonb_array_elements_text(${JSON.stringify(groupKeyCandidates(wanted))}::jsonb))`);
  return rows.map((r) => r.key);
}

/** Mẫu (stages thô) × công ty ⇒ thiếu gì. */
export async function readinessOf(
  tx: Tx,
  tid: string,
  stages: readonly unknown[],
  packTools?: PackToolCatalog,
): Promise<Readiness> {
  const needs = templateNeeds(stages, MODULES);
  const [features, tools, groupKeys] = await Promise.all([
    tenantFeatureKeys(
      tx,
      tid,
      needs.features.map((f) => f.key),
    ),
    needs.tools.length
      ? toolSwitchReader(tx, tid, packTools).available(needs.tools.map((t) => t.key))
      : Promise.resolve([]),
    tenantGroupKeys(tx, tid, needs.groups),
  ]);
  return templateReadiness(needs, {
    features,
    tools: new Set(tools.map((t) => t.key)),
    groupKeys,
  });
}

/** 422 nói thiếu gì và AI làm gì (quản trị nền tảng bật) — dùng cho gán (platform) và sao chép (công ty). */
export function notReadyError(r: Readiness, forPlatform: boolean): AppError {
  const who = forPlatform
    ? "Bật tính năng cho công ty rồi gán lại."
    : "Mẫu này chưa dùng được ở công ty bạn — nhờ quản trị nền tảng bật tính năng cần thiết rồi sao chép lại.";
  return new AppError("FLOW_TEMPLATE_NOT_READY", 422, `${r.reasons.join(" ")} ${who}`.trim(), {
    missing: r.missing,
    reasons: r.reasons,
  });
}
