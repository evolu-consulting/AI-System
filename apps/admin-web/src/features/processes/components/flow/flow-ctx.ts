// CR-122 · U1/U2: ngữ cảnh trình sửa flow (app + công ty + sự kiện của node Bắt đầu khi). Có ⇒ bàn làm việc dùng bảng node theo
// `GET /process-palette` và form Kết thúc; vắng ⇒ trình sửa giai đoạn thường / flow cũ theo khe (tới khi M1 chuyển hết).
import type { AppEventDecl } from "@ai/contracts/app-manifest";
import { createContext, useContext } from "react";

export type FlowCtx = {
  app: string;
  /** Công ty để lọc node theo tính năng đang bật; vắng (platform sửa Thư viện) ⇒ mọi node. */
  tenantId?: string | undefined;
  event: AppEventDecl | undefined;
};
export const FlowContext = createContext<FlowCtx | null>(null);
export const useFlowCtx = (): FlowCtx | null => useContext(FlowContext);
