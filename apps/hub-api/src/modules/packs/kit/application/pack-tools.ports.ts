// N2-FR-03 · N2-D02 · N2-D03 · plan N2 §4 (mở phần hoãn B6/HUB-BR-12, CR-087): tool của gói đăng ký vào Hub, chạy TRONG tx
// gói (`withPackScope` qua `PackUow` của gói), gọi được từ stage `tool` và `/mcp`. Lớp 2 — chỉ kiểu (engine/MCP dùng
// `PackToolCatalog` theo cấu trúc; registry cài đặt ở `kit/adapters/pack-tools.registry.ts`).

export type PackToolParam = {
  /** Tên tham số (`INPUT_NAME_RE`). */
  name: string;
  /** = `InputType` của catalog tool (`text`, `paragraph`, `number`, `date`, `select`, `boolean`); không `file`. */
  type: string;
  required: boolean;
  description?: string;
  options?: readonly string[];
};
export type PackToolArgs = Readonly<Record<string, string | number | boolean>>;
/** Danh tính lời gọi: tenant + người (stage tool = người bắt đầu run; `/mcp` = user của job). */
export type PackToolCtx = { tenantId: string; userId: string; runId: string | null };

export type PackToolDef = {
  pack: string;
  /** Khoá tool đầy đủ = `<pack>-<name>` (khớp `ProcessKeySchema`, ≤ 32). */
  name: string;
  description: string;
  side_effect: boolean;
  params: readonly PackToolParam[];
  /** Chạy trong tx gói của `ctx.tenantId`; trả object JSON (= `output.fields` của stage). Ném ⇒ lỗi tool. */
  run(ctx: PackToolCtx, args: PackToolArgs): Promise<Record<string, unknown>>;
};

/** Hình tool cho editor/luật lưu def (= `ToolCatalogItem` của engine). */
export type PackToolInfo = {
  key: string;
  name: string;
  description: string;
  sideEffect: boolean;
  params: readonly PackToolParam[];
};

export type PackToolCallResult =
  | { kind: "ok"; text: string }
  | { kind: "failed"; code: string; httpStatus: null; sent: boolean; reason: string | null };

/** Cổng engine/MCP thấy. `enabled` = gói của tool đang bật cho tenant (cache cấu hình, 0 SQL khi nóng). */
export type PackToolCatalog = {
  has(key: string): boolean;
  info(key: string): PackToolInfo | undefined;
  enabled(tenantId: string, key: string): Promise<boolean>;
  /** Tool của gói tenant đã bật (`keys` vắng ⇒ tất cả). */
  available(tenantId: string, keys?: readonly string[]): Promise<PackToolInfo[]>;
  call(key: string, ctx: PackToolCtx, args: PackToolArgs): Promise<PackToolCallResult>;
  /** `/mcp`: user có quyền `read` của gói (Group được cấp). */
  canUse(who: { tenantId: string; userId: string }, key: string): Promise<boolean>;
};
