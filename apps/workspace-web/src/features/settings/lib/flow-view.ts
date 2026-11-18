// CR-184 · sơ đồ + danh sách CHỈ XEM của quy trình đang chạy: cùng một đồ thị (`@ai/flow-canvas/pure`: cạnh Đúng/Sai, nhảy bước, Bắt đầu → bước đầu,
// Kết thúc) với trang quản trị. File này chỉ ghép CHỮ nghiệp vụ (VI/EN qua `t`) lên stage + dựng dòng cho chế độ «Danh sách» theo đúng thứ tự sơ đồ.
import type { DefViewStage, DefViewTrigger } from "@ai/flow-canvas/pure";
import type { CurrentFlow, CurrentGraphStage } from "./current-flow";
import { whenText } from "./start-when";

type Tr = (key: string, o?: Record<string, unknown>) => string;
const K = "contracts.flow.current";
/** Tên hiển thị của nhà cung cấp ký số (khoá lưu → chữ); khoá lạ giữ nguyên. */
const PROVIDER_NAMES: Record<string, string> = { docusign: "DocuSign" };

/** Nhãn bước Ký theo «Ký qua»: `ondoc` ⇒ Ký trên tài liệu, `upload` ⇒ Tải lên bản đã ký, nhà cung cấp ⇒ Ký số (<tên>), chưa đặt ⇒ Ký số. */
export function esignLabel(provider: string | null, t: Tr): string {
  if (provider === "ondoc") return t(`${K}.signKind.ondoc`);
  if (provider === "upload") return t(`${K}.signKind.upload`);
  if (provider) return t(`${K}.signKind.provider`, { name: PROVIDER_NAMES[provider] ?? provider });
  return t(`${K}.esign`);
}

/** Loại bước ⇒ nhãn ngắn (huy hiệu); Duyệt / Nếu / Kết thúc / bước kỹ thuật không cần nhãn. */
function badgeOf(g: CurrentGraphStage, t: Tr): string | null {
  if (g.kind === "esign") return esignLabel(g.provider, t);
  if (g.kind === "partner_send") return t(`${K}.kind.partner_send`);
  if (g.kind === "notify") return t(`${K}.kind.notify`);
  if (g.kind === "wait") return t(`${K}.kind.wait`);
  return null;
}

/** Thứ tự đúng như sơ đồ: theo `step`, cùng bước giữ thứ tự mảng. */
function ordered(flow: CurrentFlow): CurrentGraphStage[] {
  return flow.graph
    .map((g, i) => ({ g, i }))
    .sort((a, b) => a.g.step - b.g.step || a.i - b.i)
    .map((x) => x.g);
}

/** Số người duyệt của từng bước duyệt: `steps` (đã sắp theo `step`) khớp 1-1 với stage Duyệt / Ký / Thông báo của `graph`. */
function approversByKey(flow: CurrentFlow): Map<string, number> {
  const shown = ordered(flow).filter((g) => ["review", "esign", "notify"].includes(g.kind));
  const out = new Map<string, number>();
  shown.forEach((g, i) => {
    const n = flow.steps[i]?.approverCount;
    if (g.kind === "review" && typeof n === "number") out.set(g.key, n);
  });
  return out;
}

function subOf(g: CurrentGraphStage, n: number | undefined, t: Tr): string | null {
  const parts = [
    g.kind === "review" && g.department && g.department !== g.name ? g.department : null,
    n === undefined ? null : t(`${K}.info.${n === 1 ? "approver" : "approvers"}`, { count: n }),
  ].filter((x): x is string => x !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Stage của sơ đồ (đúng thứ tự `graph`) kèm chữ đã dịch. */
export function viewStages(flow: CurrentFlow, t: Tr): DefViewStage[] {
  const n = approversByKey(flow);
  return flow.graph.map((g) => ({
    uid: g.key,
    step: g.step,
    backTo: g.backTo,
    after: g.after,
    branch: g.branch,
    ifs: g.ifs,
    terminal: g.terminal,
    nextStep: g.nextStep,
    end: g.kind === "end",
    title: g.name,
    sub: subOf(g, n.get(g.key), t),
    badge: badgeOf(g, t),
  }));
}

/** Node Bắt đầu: «Bắt đầu» + «Bắt đầu khi …» (điều kiện của quy trình). */
export function viewTrigger(flow: CurrentFlow, t: Tr): DefViewTrigger {
  const when = flow.startWhenBad
    ? t(`${K}.unreadable`)
    : whenText(flow.startWhen, flow.groupNames, t);
  return { label: t(`${K}.canvas.start`), summary: t(`${K}.startWhen`, { when }) };
}

export type ListRow = {
  key: string;
  /** Số thứ tự bước (chỉ bước thường); node Nếu / Kết thúc ⇒ 0. */
  index: number;
  title: string;
  sub: string | null;
  badge: string | null;
  /** Node Nếu: hai dòng «Đúng ⇒ …» / «Sai ⇒ …» (ghi rõ nhánh). */
  branches: string[];
  end: boolean;
};

/** Tên đích của một bước (bước đầu của cột `step`); không có ⇒ «bước kế» / «—». */
function targetName(flow: CurrentFlow, step: number | null, t: Tr): string {
  const g = step === null ? undefined : ordered(flow).find((x) => x.step === step);
  return g ? g.name : t(`${K}.list.none`);
}

/** Chế độ Danh sách: cùng thứ tự với sơ đồ; node Nếu ghi rõ Đúng ⇒ / Sai ⇒ tới bước nào. */
export function listRows(flow: CurrentFlow, t: Tr): ListRow[] {
  const n = approversByKey(flow);
  let idx = 0;
  return ordered(flow).map((g) => {
    const isIf = g.ifs !== null;
    const branches = g.ifs
      ? [
          t(`${K}.list.yes`, { to: targetName(flow, g.ifs.yes, t) }),
          t(`${K}.list.no`, { to: targetName(flow, g.ifs.no ?? g.step + 1, t) }),
        ]
      : g.branch.flatMap((b, k) =>
          b === null ? [] : [t(`${K}.list.rule`, { n: k + 1, to: targetName(flow, b, t) })],
        );
    const plain = !isIf && g.kind !== "end";
    return {
      key: g.key,
      index: plain ? ++idx : 0,
      title: g.name,
      sub: subOf(g, n.get(g.key), t),
      badge: isIf ? t(`${K}.kind.if`) : badgeOf(g, t),
      branches,
      end: g.kind === "end",
    };
  });
}
