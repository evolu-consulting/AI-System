// CR-122 · U1/U2/U2c: ngữ cảnh trình sửa flow (app + công ty + sự kiện của node Bắt đầu khi). Có ⇒ bàn làm việc dùng bảng node theo
// `GET /process-palette`, form Kết thúc và vẽ node Bắt đầu khi trên canvas; vắng ⇒ trình sửa giai đoạn thường / flow cũ.
import type { AppEventDecl } from "@ai/contracts/app-manifest";
import { createContext, useContext } from "react";
import type { BridgeApi } from "../../hooks/use-bridge";
import type { StageDraft } from "../../lib/draft-types";

export type FlowCtx = {
  app: string;
  /** Công ty để lọc node theo tính năng đang bật; vắng (platform sửa Thư viện) ⇒ mọi node. */
  tenantId?: string | undefined;
  event: AppEventDecl | undefined;
  /** Node Bắt đầu khi trên canvas: nhãn sự kiện + tóm tắt điều kiện + mở thẻ sửa. */
  trigger?: { label: string; summary: string; onOpen: () => void };
  /** Cạnh vàng (FR-26): cặp stage (uid) mà bước sau cần đầu vào bước trước không có. */
  warnEdges?: readonly {
    from: string;
    to: string;
    keys: string[];
    labels: string[];
    toName: string;
  }[];
  /** Gợi ý cầu nối ngay trên canvas (trạng thái + hành động theo cạnh vàng). */
  bridge?: BridgeApi;
  /** Tên bước (0-based) cho tóm tắt node ("Chờ ký", "Kết thúc…"). */
  stepName?: (n: number) => string;
  /** CR-125 m4 · khoá node bảng đã có trong flow (nguồn cho tự nối đầu vào khi thêm node). */
  nodeKeys?: readonly string[];
  /** Sửa một stage khác theo uid (vd đặt giờ chờ của stage chờ ký khi đổi hạn ký ở stage gửi). */
  patchStage?: (uid: string, patch: Partial<StageDraft>) => void;
  /** CR-123 · u3a · sửa NHIỀU stage trong MỘT lần đổi (cụm node module: tên, cấu hình + giờ chờ) — không để lần sau ghi đè lần trước. */
  patchStages?: (items: readonly { uid: string; patch: Partial<StageDraft> }[]) => void;
  /** Workbench đăng ký hàm chọn node (bấm cảnh báo kiểm nối ⇒ chọn node trên canvas). */
  selectRef?: { current: ((uid: string) => void) | null };
};
export const FlowContext = createContext<FlowCtx | null>(null);
export const useFlowCtx = (): FlowCtx | null => useContext(FlowContext);

/** Mức zoom tối thiểu khi fit canvas: flow (cột Bắt đầu khi + ≥ 8 bước) đọc được; Canvas thư viện cũ 0.7; mặc định của canvas. */
export const useFitMin = (lib: boolean): number | undefined =>
  useFlowCtx() ? 0.75 : lib ? 0.7 : undefined;

/** Workbench đăng ký hàm chọn node để ngoài canvas (cảnh báo kiểm nối) chọn đúng node. */
export function useRegisterSelect(select: (uid: string) => void): void {
  const ctx = useFlowCtx();
  if (ctx?.selectRef) ctx.selectRef.current = select;
}
