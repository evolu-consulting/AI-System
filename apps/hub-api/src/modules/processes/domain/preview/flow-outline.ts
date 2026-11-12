// CR-127 · M4 · luật THUẦN "các bước HĐ sẽ đi qua": cùng bộ đi đường của Chạy thử (`approveAll` = Duyệt hết theo dữ kiện HIỆN TẠI, node Nếu chọn
// nhánh theo dữ kiện thật) rồi rút gọn thành danh sách cho người Gửi: bỏ node Nếu / Kết thúc, đặt nhãn "ai làm". Không luật thứ hai.
import type { FlowOutline } from "../../../packs/kit/public";
import { approveAll } from "./flow-preview.scenarios";
import type { PathStep, PreviewInput } from "./flow-preview.walk";

type Step = FlowOutline["steps"][number];

const NODE_KIND: Record<string, { kind: Step["kind"]; who: string }> = {
  "contracts.esign": { kind: "esign", who: "Các bên ký" },
  "contracts.sign-together-accept": { kind: "esign", who: "Các bên ký" },
  "contracts.partner-send": { kind: "partner_send", who: "Đối tác" },
  "contracts.milestone-confirm": { kind: "milestone", who: "Người phụ trách" },
  "core.email": { kind: "notify", who: "Tự động" },
  "core.bell": { kind: "notify", who: "Tự động" },
};
const NAMES_MAX = 3;

/** Người/phòng nhận việc của bước Duyệt: ≤ 3 người ⇒ tên; nhiều hơn ⇒ tên phòng (+ số người); chưa có ai ⇒ nói rõ để người Gửi biết. */
function whoOfReview(r: NonNullable<PathStep["review"]>): string {
  if (r.who_total === 0) return "Chưa chọn người duyệt";
  if (r.who_total <= NAMES_MAX && r.who.length === r.who_total)
    return r.who.map((h) => h.name).join(", ");
  return r.group_name ? `${r.group_name} (${r.who_total} người)` : `${r.who_total} người`;
}

function stepOf(p: PathStep): Step {
  if (p.kind === "review" && p.review) {
    return {
      kind: "review",
      label: p.name,
      whoLabel: whoOfReview(p.review),
      ...(p.review.due_h !== null ? { dueH: p.review.due_h } : {}),
    };
  }
  const n = (p.node ? NODE_KIND[p.node] : undefined) ?? { kind: "step" as const, who: "Tự động" };
  return { kind: n.kind, label: p.name, whoLabel: n.who };
}

/** Các bước của MỘT quy trình theo dữ kiện `i.facts` (người Gửi = `starterId`). Nhánh đi qua trước, bước không đi qua bị bỏ. */
export function outlineSteps(i: Omit<PreviewInput, "decisions">): Step[] {
  const { result } = approveAll(i);
  return result.path
    .filter((p) => p.kind !== "if" && p.kind !== "end" && p.status !== "skipped")
    .map(stepOf);
}
