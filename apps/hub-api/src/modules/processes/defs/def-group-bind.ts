// CR-122 · P15 · def CÔNG TY chỉ nhận id Group. Client cũ / bản sao từ Thư viện có thể còn mã (`group_key`) ⇒ đổi sang id của
// chính công ty bằng đúng luật lúc chạy (`bindGroupKeys`). Mã không có nhóm ở công ty ⇒ 422 nói rõ mã (không để lọt tới PROCESS_REF_INVALID).
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import {
  applyNodeAssignee,
  groupKeyCandidates,
  MODULES,
  mapGroupKey,
  nodeAssigneeMessage,
  nodeAssigneeNeeds,
} from "@ai/contracts/modules";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { AppError } from "../../../lib/errors";
import { bindGroupKeys, groupKeysOf } from "../triggers/group-keys.rules";

/** CR-122 · P6 · def Thư viện = có khe HOẶC (tenant NULL + `trigger`): Group chỉ theo MÃ (map → id lúc mở lượt, E1b); def công ty chỉ theo id. */
export function isLibraryDef(
  tenantId: string | null,
  slot: string | null,
  trigger: unknown,
): boolean {
  return slot !== null || (tenantId === null && !!trigger);
}

/** CR-126 · nhóm phụ trách của node module (cấu hình node) ⇒ `after.group_*` của stage người làm trong cụm — tính lại mỗi lần lưu. */
export const withNodeAssignee = (input: ProcessDefInput): ProcessDefInput => {
  // Quy trình BẬT mà node có bước người làm chưa chọn nhóm phụ trách ⇒ bước đó sẽ không ai nhận ⇒ chặn lưu với câu nghiệp vụ.
  const miss = input.enabled
    ? nodeAssigneeNeeds(input.stages, MODULES).find((n) => !n.group)
    : undefined;
  if (miss)
    throw new AppError("NODE_ASSIGNEE_MISSING", 422, nodeAssigneeMessage(miss.label), {
      stage: miss.stage,
      node: miss.node,
    });
  return { ...input, stages: applyNodeAssignee(input.stages, MODULES) };
};

/** `slotted` (đường khe / bản riêng) hoặc def mẫu (tenant null) ⇒ giữ nguyên; còn lại là def công ty ⇒ mã → id. */
export const bindIfCompany = (
  tx: Tx,
  tenantId: string | null,
  slotted: boolean,
  raw: ProcessDefInput,
): Promise<ProcessDefInput> => {
  const input = withNodeAssignee(raw);
  return slotted || tenantId === null
    ? Promise.resolve(input)
    : bindCompanyGroupKeys(tx, tenantId, input);
};

/**
 * Mã → id Group của công ty (MỘT câu). KHỚP ĐÚNG MÃ (mặc định): lưu def công ty và mở lượt không bao giờ tự đổi nhóm duyệt.
 * `{ alias: true }` (CHỈ đường sao chép/readiness của mẫu mới): `<app>-admin` ⇒ nhóm chủ gói `<app>-owner` (một luật `mapGroupKey`).
 */
export async function groupIdsByKey(
  tx: Tx,
  tenantId: string,
  keys: readonly string[],
  opts: { alias?: boolean } = {},
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const wanted = opts.alias === true ? groupKeyCandidates(keys) : keys;
  const gs = await tx.execute<{ id: string; key: string }>(sql`select id, key from admin.groups
    where tenant_id = ${tenantId}::uuid and key in (select jsonb_array_elements_text(${JSON.stringify(wanted)}::jsonb))`);
  const have = gs.map((g) => g.key);
  const idOf = new Map(gs.map((g) => [g.key, g.id]));
  return new Map(
    keys.flatMap((k) => {
      const hit = opts.alias === true ? mapGroupKey(k, have) : idOf.has(k) ? k : null;
      const id = hit ? idOf.get(hit) : undefined;
      return id ? [[k, id] as const] : [];
    }),
  );
}

export const groupMissingMessage = (keys: readonly string[]): string =>
  `Nhóm ${keys.join(", ")} chưa có ở công ty — chọn nhóm khác.`;

/** Def công ty: đổi mọi mã Group hợp lệ của công ty sang id; mã lạ ⇒ 422 `GROUPS_MISSING`. Không có mã ⇒ trả nguyên input. */
export async function bindCompanyGroupKeys(
  tx: Tx,
  tenantId: string,
  input: ProcessDefInput,
): Promise<ProcessDefInput> {
  const runKeys = input.run_group_keys ?? [];
  const keys = [...new Set([...groupKeysOf(input.stages), ...runKeys])];
  if (keys.length === 0) return input;
  const ids = await groupIdsByKey(tx, tenantId, keys);
  const b = bindGroupKeys(input.stages, ids, { strip: true });
  const runMissing = runKeys.filter((k) => !ids.has(k));
  const missing = [...new Set([...b.missing, ...runMissing])];
  if (missing.length)
    throw new AppError("GROUPS_MISSING", 422, groupMissingMessage(missing), { keys: missing });
  const { run_group_keys: _r, ...rest } = input;
  return {
    ...rest,
    stages: b.stages as ProcessDefInput["stages"],
    run_group_ids: [
      ...new Set([...input.run_group_ids, ...runKeys.flatMap((k) => ids.get(k) ?? [])]),
    ],
  };
}
