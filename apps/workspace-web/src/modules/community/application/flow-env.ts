// CR-191 · phần ngữ cảnh TỐI THIỂU của các màn luồng (danh sách + duyệt): API luồng, làm mới, toast, màu nhấn.
// Trang Community cấp từ `AppProvider`; trang Sổ Hợp Tác › Đối tác cấp từ `ui/embed/JoinReviewPane` (không cần người xem/router của Community).
import { createContext, useContext } from "react";
import type { FlowsApi } from "./ports";

export type FlowEnv = {
  flows: FlowsApi;
  /** Tăng sau mỗi thay đổi dữ liệu: danh sách nạp lại. */
  rev: number;
  bump: () => void;
  toast: (msg: string) => void;
  brandAccent: string;
};

export const FlowEnvCtx = createContext<FlowEnv | null>(null);
export const useFlowEnv = (): FlowEnv => {
  const v = useContext(FlowEnvCtx);
  if (!v) throw new Error("Thiếu FlowEnv"); // i18n-ignore: lỗi lập trình
  return v;
};
