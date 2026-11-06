// CR-122 · U1/U2/U2c: ngữ cảnh trình sửa flow (app + công ty + sự kiện của node Bắt đầu khi). Có ⇒ bàn làm việc dùng bảng node theo
// `GET /process-palette`, form Kết thúc và vẽ node Bắt đầu khi trên canvas; vắng ⇒ trình sửa giai đoạn thường / flow cũ.
import type { AppEventDecl } from "@ai/contracts/app-manifest";
import { createContext, useContext } from "react";

export type FlowCtx = {
  app: string;
  /** Công ty để lọc node theo tính năng đang bật; vắng (platform sửa Thư viện) ⇒ mọi node. */
  tenantId?: string | undefined;
  event: AppEventDecl | undefined;
  /** Node Bắt đầu khi trên canvas: nhãn sự kiện + tóm tắt điều kiện + mở thẻ sửa. */
  trigger?: { label: string; summary: string; onOpen: () => void };
  /** Cạnh vàng (FR-26): cặp stage (uid) mà bước sau cần đầu vào bước trước không có. */
  warnEdges?: readonly { from: string; to: string }[];
};
export const FlowContext = createContext<FlowCtx | null>(null);
export const useFlowCtx = (): FlowCtx | null => useContext(FlowContext);
