// dlc-agent-flows · Agent Forge › Sửa agent › "Quy trình DLC": tool gói agent được gọi (`runtime_options.pack_tools`) + quy trình
// thư viện agent dùng khi mở lượt DLC (`runtime_options.dlc_flows`, mỗi dây chuyền một def thư viện theo key; vắng ⇒ theo tenant).
import { z } from "zod";

/** Ba dây chuyền DLC (khe thư viện `dlc.<mode>`) — cùng `DLC_MODES` của gói `dlc` (gói không import contract, giữ tay). */
export const DLC_FLOW_MODES = ["new-system", "enhancement", "bug-fix"] as const;
export type DlcFlowMode = (typeof DLC_FLOW_MODES)[number];
export const dlcFlowSlotOf = (m: DlcFlowMode) => `dlc.${m}` as const;

/** Key def thư viện quy trình. */
export const DLC_FLOW_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `runtime_options.dlc_flows`: dây chuyền → key def thư viện (đã xuất bản, đúng khe); khoá lạ ⇒ ✗. */
export const DlcFlowsSchema = z.strictObject({
  "new-system": z.string().regex(DLC_FLOW_KEY_RE).optional(),
  enhancement: z.string().regex(DLC_FLOW_KEY_RE).optional(),
  "bug-fix": z.string().regex(DLC_FLOW_KEY_RE).optional(),
});
export type DlcFlows = z.infer<typeof DlcFlowsSchema>;

/** `GET /studio/api/dlc-flows`: def thư viện ĐÃ xuất bản của từng khe DLC (cho Select "Quy trình dùng khi agent mở lượt"). */
export const DlcFlowDefSchema = z.strictObject({
  key: z.string(),
  name: z.string(),
  published_version: z.number().int().min(1),
});
export const DlcFlowSlotSchema = z.strictObject({
  mode: z.enum(DLC_FLOW_MODES),
  slot: z.string(),
  defs: z.array(DlcFlowDefSchema),
});
export const DlcFlowListSchema = z.strictObject({ items: z.array(DlcFlowSlotSchema) });
export type DlcFlowList = z.infer<typeof DlcFlowListSchema>;

/** `GET /studio/api/pack-tools`: tool gói (registry) agent được gắn qua `pack_tools` — không gồm tool chỉ stage gọi. */
export const PackToolItemSchema = z.strictObject({
  key: z.string(),
  pack: z.string(),
  description: z.string(),
  action: z.enum(["read", "write"]),
});
export const PackToolListSchema = z.strictObject({ items: z.array(PackToolItemSchema) });
export type PackToolList = z.infer<typeof PackToolListSchema>;
