// CR-127 · U1 · spec §8.1: người dùng không thấy node Kết thúc — FE tự thêm "Hoàn tất" cuối đường chính và đích Từ chối / Trả lại mặc định
// cho node Duyệt chưa chọn đích (cùng ý `approve-rules.ts`: Từ chối ⇒ Kết thúc · Từ chối, Trả lại ⇒ Kết thúc · Trả lại). Thuần.
import type { ProcessStageDef } from "@ai/contracts/hub-admin";
import { type Outline, walkOutline } from "./outline";
import type { OutlineExit, OutlineNode } from "./outline-refs";

export type EndOutcomes = {
  approved: string;
  rejected: string;
  returned: string;
  /** Nhãn hiển thị theo khoá kết quả (app khai); vắng ⇒ nhãn mặc định «Đã duyệt / Từ chối / Trả lại». */
  labels?: Readonly<Record<string, string>>;
};
/** Khoá kết quả của app Hợp đồng (`AppEventDecl.outcomes`); app khác truyền bộ riêng. */
export const CONTRACT_OUTCOMES: EndOutcomes = {
  approved: "approved",
  rejected: "rejected",
  returned: "returned",
};
const LABELS: Record<"approved" | "rejected" | "returned", string> = {
  approved: "Đã duyệt",
  rejected: "Từ chối",
  returned: "Trả lại",
};

/**
 * Kết quả mặc định cho Hoàn tất / Từ chối / Trả lại theo sự kiện của app: khoá `approved|rejected|returned` có thì dùng (app hợp đồng);
 * không thì lấy theo thứ tự app khai (đầu = Hoàn tất, thứ hai = Từ chối, thứ ba = Trả lại; thiếu ⇒ dùng lại kết quả cuối) để Kết thúc tạo sẵn luôn hợp lệ.
 * Sự kiện vắng / không có kết quả ⇒ bộ của app hợp đồng.
 */
export function endOutcomesOf(
  event: { outcomes: readonly { key: string; label: string }[] } | undefined,
): EndOutcomes {
  const outs = event?.outcomes ?? [];
  const first = outs[0];
  if (!first) return CONTRACT_OUTCOMES;
  const has = (k: string) => outs.some((o) => o.key === k);
  if (has("approved") && has("rejected") && has("returned")) return CONTRACT_OUTCOMES;
  const at = (i: number) => (outs[i] ?? outs[outs.length - 1] ?? first).key;
  return {
    approved: first.key,
    rejected: at(1),
    returned: at(2),
    labels: Object.fromEntries(outs.map((o) => [o.key, o.label])),
  };
}

/** Node Kết thúc mới (cùng hình mẫu Thư viện: node `set` rỗng + `outcome`). */
export function endStage(outcome: string, label: string): ProcessStageDef {
  return {
    key: `ket-thuc-${outcome}`,
    name: `Kết thúc · ${label}`,
    instruction: "",
    executor: { kind: "set", values: [] },
    output: { filename: "end.md", template: "x", required_sections: ["x"], fields: [] },
    after: { kind: "auto", branch: [] },
    real_action: false,
    answerer: { kind: "starter" },
    timeout_s: 60,
    token_budget: null,
    sources: [],
    must_know: [],
    autofix: null,
    outcome,
  };
}

const endNode = (outcome: string, label: string): OutlineExit => ({
  kind: "end",
  stage: endStage(outcome, label),
  refs: {},
});

/** Đường đi này đã tới một node Kết thúc chưa (nhánh Nếu đều kết thúc ⇒ đã kết thúc). */
function terminated(items: readonly OutlineNode[]): boolean {
  const last = items[items.length - 1];
  if (!last) return false;
  if (last.kind === "end") return true;
  return last.kind === "if" && terminated(last.yes) && terminated(last.no);
}

/**
 * Trả bản sao cây có đủ: Hoàn tất cuối đường chính (nếu chưa kết thúc) + Kết thúc · Từ chối / Trả lại cho mọi node Duyệt chưa chọn đích
 * (dùng node Kết thúc cùng kết quả đã có; chưa có ⇒ thêm vào `exits`). Không đụng đích đã chọn. Chạy lại không đổi gì thêm.
 */
export function withDefaultEnds(o: Outline, outcomes: EndOutcomes = CONTRACT_OUTCOMES): Outline {
  const out: Outline = structuredClone(o);
  const ends = new Map<string, string>(); // outcome ⇒ mã node
  const note = (n: OutlineNode) => {
    if (n.kind === "end" && n.stage.outcome !== undefined && !ends.has(n.stage.outcome))
      ends.set(n.stage.outcome, n.stage.key);
  };
  walkOutline(out.items, note);
  out.exits.forEach(note);
  const ensure = (kind: "approved" | "rejected" | "returned"): string => {
    const have = ends.get(outcomes[kind]);
    if (have) return have;
    const e = endNode(outcomes[kind], outcomes.labels?.[outcomes[kind]] ?? LABELS[kind]);
    if (kind === "approved") out.items.push(e);
    else out.exits.push(e);
    ends.set(outcomes[kind], e.stage.key);
    return e.stage.key;
  };
  if (!terminated(out.items)) {
    // Hoàn tất luôn đứng cuối đường chính: node "approved" đang nằm ngoài (chỉ được trỏ tới) ⇒ kéo vào đường chính.
    const at = out.exits.findIndex((x) => x.stage.outcome === outcomes.approved);
    if (at >= 0) out.items.push(...out.exits.splice(at, 1));
    else ensure("approved");
  }
  walkOutline(out.items, (n) => {
    if (n.kind === "end" || (n.stage.executor as { kind: string }).kind !== "approve") return;
    if (n.refs.reject == null) n.refs.reject = ensure("rejected");
    if (n.refs.ret == null) n.refs.ret = ensure("returned");
  });
  return out;
}
