// CR-122 · U1: ngữ cảnh trình sửa flow (app + sự kiện của node Bắt đầu khi). Có ⇒ bàn làm việc dùng bảng node theo manifest
// và form Kết thúc; vắng ⇒ trình sửa giai đoạn thường / flow cũ theo khe (tới khi M1 chuyển hết).
import type { AppEventDecl } from "@ai/contracts/app-manifest";
import { createContext, useContext } from "react";

export type FlowCtx = { app: string; event: AppEventDecl | undefined };
export const FlowContext = createContext<FlowCtx | null>(null);
export const useFlowCtx = (): FlowCtx | null => useContext(FlowContext);
