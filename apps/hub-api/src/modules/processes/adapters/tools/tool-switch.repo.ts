// HUB-FR-146 · AC-H47 · TT-R04/R05 · D2-14 · plan-d2 §9 · S9: tool khả dụng của tenant = workflow `enabled` ∧ công tắc
// `admin.tenant_workflow_tools` còn hiệu lực CỦA ĐÚNG tenant. `hub_ro` policy `USING (true)` ⇒ `t.tenant_id = $tenant`
// tường minh là rào duy nhất. MỘT câu, văn bản cố định (khoá theo `= any($keys)` hoặc `limit 200`), không cache (TT-R06).
import type { ProcessToolItem } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ToolCatalogItem, ToolSwitchReader } from "../../application/tools/tool.ports";
import type { ToolDefShape } from "../../domain/defs/tool-def.rules";

/** Catalog editor: trần số tool (Q-T13-3 ⇒ D2-26). */
export const TOOL_CATALOG_MAX = 200;

/** Hàng catalog đầy đủ cho editor (`ProcessToolItem`) — mapper ở `defs.service`. */
export type ToolRow = {
  key: string;
  name: string;
  description: string;
  side_effect: boolean;
  input_schema: unknown;
};

const keysLit = (keys: readonly string[]) => `{${keys.join(",")}}`;

/** `keys` vắng ⇒ mọi tool (≤ 200, theo key). Key đã qua `ProcessKeySchema` (không dấu phẩy/ngoặc) ⇒ literal mảng an toàn. */
export async function availableToolRows(
  tx: Tx,
  tenantId: string,
  keys?: readonly string[],
): Promise<ToolRow[]> {
  const byKey = keys === undefined ? sql`` : sql` and w.key = any(${keysLit(keys)}::text[])`;
  const rows =
    await tx.execute<ToolRow>(sql`select w.key, w.name, w.description, w.side_effect, w.input_schema
    from admin.workflows w
    join admin.tenant_workflow_tools t
      on t.workflow_id = w.id and t.tenant_id = ${tenantId} and t.revoked_at is null
    where w.enabled${byKey}
    order by w.key limit ${TOOL_CATALOG_MAX}`);
  return [...rows];
}

type RawParam = { name?: unknown; type?: unknown; required?: unknown; options?: unknown };

/** `input_schema` (jsonb đã kiểm ở admin) ⇒ tham số domain; phần tử hỏng bị bỏ. */
export function paramsOf(schema: unknown): ToolDefShape["params"] {
  if (!Array.isArray(schema)) return [];
  return (schema as RawParam[]).flatMap((p) =>
    typeof p?.name === "string" && typeof p.type === "string"
      ? [
          {
            name: p.name,
            type: p.type,
            required: p.required === true,
            ...(Array.isArray(p.options) ? { options: p.options as string[] } : {}),
          },
        ]
      : [],
  );
}

export const toolDefOf = (r: ToolRow): ToolCatalogItem => ({
  key: r.key,
  name: r.name,
  description: r.description,
  sideEffect: r.side_effect === true,
  params: paramsOf(r.input_schema),
});

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

/** Domain ⇒ `ProcessToolItem` (A1); mô tả tham số chỉ khi là chuỗi hợp lệ (`description`/`label` cũ của input_schema). */
export function toToolItem(t: ToolCatalogItem): ProcessToolItem {
  return {
    key: t.key,
    name: clip(t.name, 128),
    description: clip(t.description ?? "", 400),
    side_effect: t.sideEffect,
    params: t.params.map((p) => ({
      name: p.name,
      type: p.type as ProcessToolItem["params"][number]["type"],
      required: p.required,
      ...(p.type === "select" && p.options ? { options: [...p.options] } : {}),
    })),
  };
}

/** Cổng `ToolSwitchReader` gắn tx + tenant của người gọi (editor: tx đọc; lưu def: tx ghi def). */
export function toolSwitchReader(tx: Tx, tenantId: string): ToolSwitchReader {
  return {
    available: async (keys) => (await availableToolRows(tx, tenantId, keys)).map(toolDefOf),
  };
}
