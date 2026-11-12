// CR-127 NF1 · fixture dùng chung: "Xác nhận & lưu" / Gửi cần quy trình duyệt khớp (không có ⇒ 409 NO_APPROVAL_FLOW).
// Test chỉ cần phần LƯU/chuyển trạng thái (không chạy engine thật) ⇒ đặt tạm bộ tìm quy trình "luôn có" quanh một lệnh, rồi TRẢ LẠI (null).
import { registerFlowEngine } from "../../../apps/hub-api/src/modules/packs/kit/public";

export async function withFlowEngine<T>(fn: () => Promise<T>): Promise<T> {
  registerFlowEngine({ runControl: {}, availability: { hasFlowFor: async () => true } } as never);
  try {
    return await fn();
  } finally {
    registerFlowEngine(null);
  }
}
