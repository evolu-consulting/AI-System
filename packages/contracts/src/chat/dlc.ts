// DLC-R11 · DLC-R12 · kênh chat ↔ Hub cho agent `dlc` (AI SDLC): `GET /dlc/workspaces` (sidebar "Workspaces" — các hội thoại
// có dự án DLC) và `GET /dlc/conversations/:id/process` (modal "Xem Process": các node của run hiện tại, trạng thái, số lần
// gọi agent, chi phí, token). Hub đọc engine DLC thay trình duyệt (BFF); engine không tới được / chưa cấu hình → 200 với
// `engine` ≠ `ok` (không thêm mã lỗi vào `CHAT_API_ERRORS`).
import { z } from "zod";
import { UuidSchema } from "../common";

export const DLC_WORKSPACES_MAX = 50;
export const DLC_NODES_MAX = 20;
export const DLC_ENGINE_STATES = ["ok", "unreachable", "not_configured"] as const;
export const DLC_NODE_STATES = [
  "pending",
  "running",
  "paused",
  "done",
  "failed",
  "skipped",
] as const;

const IdSchema = z.string().min(1).max(200);
const MsSchema = z.number().int().nonnegative().nullable();
const CountSchema = z.number().int().nonnegative();

export const DlcEngineStateSchema = z.enum(DLC_ENGINE_STATES);
export type DlcEngineState = z.infer<typeof DlcEngineStateSchema>;

export const DlcWorkspaceSchema = z.strictObject({
  conversation_id: UuidSchema,
  title: z.string().max(200),
  project: IdSchema.nullable(),
  run: IdSchema.nullable(),
  /** Trạng thái run DLC (`green`, `building`…); null khi chưa đọc được engine. */
  run_state: z.string().max(40).nullable(),
  updated_at: z.string(),
});
export type DlcWorkspace = z.infer<typeof DlcWorkspaceSchema>;

export const DlcWorkspacesResponseSchema = z.strictObject({
  engine: DlcEngineStateSchema,
  items: z.array(DlcWorkspaceSchema).max(DLC_WORKSPACES_MAX),
});
export type DlcWorkspacesResponse = z.infer<typeof DlcWorkspacesResponseSchema>;

export const DlcNodeSchema = z.strictObject({
  id: IdSchema,
  title: z.string().max(200),
  state: z.enum(DLC_NODE_STATES),
  roles: z.array(z.string().max(100)).max(50),
  started_ms: MsSchema,
  ended_ms: MsSchema,
  llm_calls: CountSchema,
  usd: z.number().nonnegative(),
  tokens_in: CountSchema,
  tokens_out: CountSchema,
  /** Chỉ node build: số phần (unit) và số phần đã ghép. */
  units: CountSchema.nullable(),
  merged: CountSchema.nullable(),
});
export type DlcNode = z.infer<typeof DlcNodeSchema>;

export const DlcProcessResponseSchema = z.strictObject({
  engine: DlcEngineStateSchema,
  project: IdSchema.nullable(),
  run: IdSchema.nullable(),
  run_state: z.string().max(40).nullable(),
  paused: z.boolean(),
  nodes: z.array(DlcNodeSchema).max(DLC_NODES_MAX),
});
export type DlcProcessResponse = z.infer<typeof DlcProcessResponseSchema>;
