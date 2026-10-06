// HUB-FR-72 · HUB-FR-64 · H4a-R04, R13 · plan §2.5 · hàng DB → item catalog Studio (hàm thuần, test cạnh file).
import { InputSchemaSchema } from "@ai/contracts";
import type { ProviderItemSchema, WorkflowItemSchema } from "@ai/contracts/studio";
import type { z } from "zod";
import { difyAgentInput } from "../dify/dify.rules";

type Usable = z.infer<typeof WorkflowItemSchema>["usable_for"][number];
export type ListMeta<T> = {
  items: T[];
  total: number;
  truncated: boolean;
  hub_config_version: number;
};

/** Lọc `q` (không phân biệt hoa thường, chứa chuỗi) trên các trường chữ của item, rồi cắt `limit`. */
export function toList<T>(
  rows: readonly T[],
  opts: { q?: string; limit: number; version: number; text: (r: T) => readonly string[] },
): ListMeta<T> {
  const q = opts.q?.toLowerCase();
  const hit = q ? rows.filter((r) => opts.text(r).some((s) => s.toLowerCase().includes(q))) : rows;
  return {
    items: hit.slice(0, opts.limit),
    total: hit.length,
    truncated: hit.length > opts.limit,
    hub_config_version: opts.version,
  };
}

/** R14 H2a · có input nhận tin cho agent dify-* (`input_schema` hỏng ⇒ false). Dùng chung catalog + ghi agent (B4). */
export function hasDifyInput(inputSchema: unknown): boolean {
  const inputs = InputSchemaSchema.safeParse(inputSchema);
  return inputs.success && difyAgentInput(inputs.data) !== null;
}

/**
 * QB3 · workflow bật luôn dùng được làm tool MCP; `dify-workflow` cần app `workflow`, `dify-agent` cần app `chat|agent`,
 * cả hai cần input nhận tin (`difyAgentInput ≠ null`, R14 H2a). `input_schema` hỏng ⇒ chỉ `tool`.
 */
export function usableFor(appType: string, inputSchema: unknown): Usable[] {
  const out: Usable[] = ["tool"];
  if (!hasDifyInput(inputSchema)) return out;
  if (appType === "workflow") out.push("dify-workflow");
  if (appType === "chat" || appType === "agent") out.push("dify-agent");
  return out;
}

export type ProviderRow = {
  id: string;
  key: string;
  kind: string;
  vendor: string;
  baseUrl: string | null;
  hasSecret: boolean;
  maxConcurrency: number;
  enabled: boolean;
  devOnly: boolean;
  status: string | null;
  cooldownUntil: Date | null;
  utilization: number | null;
};

/** R13: dựng item từ danh sách trường cho phép (không spread hàng DB) ⇒ không bao giờ lọt cột lạ. */
export function toProviderItem(r: ProviderRow): z.infer<typeof ProviderItemSchema> {
  return {
    id: r.id,
    key: r.key,
    kind: r.kind,
    vendor: r.vendor,
    base_url: r.baseUrl,
    has_secret: r.hasSecret,
    max_concurrency: r.maxConcurrency,
    enabled: r.enabled,
    dev_only: r.devOnly,
    state:
      r.status === null
        ? null
        : {
            status: r.status,
            cooldown_until: r.cooldownUntil ? r.cooldownUntil.toISOString() : null,
            utilization: r.utilization,
          },
  };
}
