// CR-126 · cr126-request-page · luật thuần của đầu trang yêu cầu: dòng «Đang chờ …», tóm tắt cho người duyệt, «Duyệt bởi X, dd/mm».
import type { FlowStepView } from "@ai/contracts/flow";
import type { RequestStepNode, StartRequestView } from "@ai/contracts/hub-admin";
import { ddmm } from "~/components/shared/format";
import { flattenSteps } from "./request-tree";

export type WaitingItem = { who: string | null; part: number | null; step: string };
export type Waiting =
  | { kind: "done" }
  | { kind: "waiting"; items: WaitingItem[] }
  | { kind: "none" };

const OPEN_STEP = new Set(["open", "needs_decision"]);

const whoOf = (s: FlowStepView): string | null =>
  s.assignee && s.assignee.kind !== "system" ? s.assignee.label : null;

/** Ai đang giữ việc: mọi bước đang mở (cả chờ duyệt / cần quyết định / chờ trả lời gộp một cách nói). `part` = số Phần (null khi chỉ có một lượt). */
export function waitingOf(root: RequestStepNode, status: string): Waiting {
  if (status === "done") return { kind: "done" };
  const nodes = flattenSteps(root);
  const items: WaitingItem[] = [];
  for (const [i, n] of nodes.entries())
    for (const s of n.flow.steps)
      if (OPEN_STEP.has(s.status) || (s.status === "running" && whoOf(s) !== null))
        items.push({ who: whoOf(s), part: nodes.length > 1 ? i + 1 : null, step: s.name });
  return items.length === 0 ? { kind: "none" } : { kind: "waiting", items };
}

/** «<tên> · Phần N – <bước>» cho từng việc, nối bằng «; ». */
export function waitingText(items: WaitingItem[], partWord: string): string {
  return items
    .map((it) => {
      const where = `${it.part ? `${partWord} ${it.part} – ` : ""}${it.step}`;
      return it.who ? `${it.who} · ${where}` : where;
    })
    .join("; ");
}

export type ReviewSummary = { partner?: string; total?: string; proposer?: string };
type Field = StartRequestView["fields"][number];

const PARTNER = /(partner|supplier|vendor|ncc|doi_?tac|nha_?cung|customer|khach)/i;
const PROPOSER = /(proposer|requester|de_?xuat|nguoi_?gui|nguoi_?tao)/i;
const TOTAL = /(total|tong|amount|so_?tien|gia_?tri|value)/i;
const hit = (re: RegExp, f: Field) => re.test(f.key) || re.test(f.label);
const money = (v: string): string => `${Number(v).toLocaleString("vi-VN")} đ`;

/** Tóm tắt từ ô phiếu (thiếu ô nào bỏ ô đó). Tổng tiền: ô tiền khớp «tổng/số tiền», không có thì ô tiền đầu tiên. Người đề xuất: ô phiếu, không có ⇒ người gửi. */
export function summaryOf(fields: Field[], starterName?: string): ReviewSummary {
  const filled = fields.filter((f) => f.value.trim() !== "");
  const partner = filled.find(
    (f) => f.type !== "money" && f.type !== "attachments" && hit(PARTNER, f),
  );
  const moneys = filled.filter((f) => f.type === "money" && !Number.isNaN(Number(f.value)));
  const total = moneys.find((f) => hit(TOTAL, f)) ?? moneys[0];
  const proposer = filled.find((f) => f.type !== "money" && hit(PROPOSER, f));
  const who = proposer?.value ?? starterName;
  return {
    ...(partner ? { partner: partner.value } : {}),
    ...(total ? { total: money(total.value) } : {}),
    ...(who ? { proposer: who } : {}),
  };
}

/** Các phần có mặt, nối « · » (proposerWord = «Người đề xuất»). */
export function summaryText(s: ReviewSummary, proposerWord: string): string {
  return [s.partner, s.total, s.proposer ? `${proposerWord} ${s.proposer}` : null]
    .filter((x): x is string => !!x)
    .join(" · ");
}

/** Bước đã duyệt xong: tên người quyết + ngày; còn lại null. */
export function approvedBy(s: FlowStepView): { name: string; date: string } | null {
  if (s.status !== "passed" || !s.decided_by) return null;
  return { name: s.decided_by.name, date: s.decided_at ? ddmm(s.decided_at) : "" };
}

/** Phần «hiện tại» của cây: có việc của người xem > có bước đang mở > lượt chưa xong đầu tiên > gốc. */
export function currentNode(root: RequestStepNode, focus?: string): RequestStepNode {
  const all = flattenSteps(root);
  return (
    all.find((n) => n.run_id === focus) ??
    all.find((n) => n.flow.tasks.length > 0) ??
    all.find((n) => n.flow.steps.some((s) => OPEN_STEP.has(s.status) || s.status === "running")) ??
    all.find((n) => n.status !== "done") ??
    root
  );
}
