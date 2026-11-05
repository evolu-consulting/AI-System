// CR-118 · cr118-flow-web · lượt `mode=machine` (máy trạng thái cũ, không có bước engine): FlowPanel không vẽ dòng bước. Thẻ của gói
// (nút Xác nhận/Duyệt, ghi chú, lý do từ chối) vẫn do khe tự vẽ như trước — renderer này chỉ đánh dấu để khe biết đây là lượt cũ.
import type { FlowView } from "@ai/contracts/flow";

export function LegacyMachineRenderer({ view }: { view: FlowView }) {
  return <span hidden data-flow="legacy-machine" data-flow-phase={view.phase ?? undefined} />;
}
