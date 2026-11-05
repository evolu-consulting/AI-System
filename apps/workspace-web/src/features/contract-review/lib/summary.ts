// V2-F · HD-04: các điểm chính của khối "Tóm tắt hợp đồng", suy từ dữ liệu đã lưu (không bịa câu chữ). Thuần.
import type { ContractDetail } from "@ai/contracts";
import { viDate, vnd } from "~/components/shared/format";
import { dealOf } from "~/features/contract-form/lib/deal";
import { progressOf } from "~/features/contract-milestones/lib/timeline";

export type SummaryInput = Pick<
  ContractDetail,
  | "deal"
  | "direction"
  | "fields"
  | "items"
  | "milestones"
  | "next_milestone_id"
  | "commission_pct"
  | "commission_fixed"
>;

const money = (v: number | null): string => (v === null ? "—" : `${vnd(v)} đ`);
const dayOf = (v: unknown): string | null => (typeof v === "string" ? viDate(v) : null);

/** Hoa hồng của HĐ Giới thiệu: % nếu có, không thì số tiền cố định. */
export function commissionText(
  c: Pick<SummaryInput, "commission_pct" | "commission_fixed">,
): string {
  if (c.commission_pct != null) return `${c.commission_pct}%`;
  return money(c.commission_fixed);
}

export function periodText(c: Pick<SummaryInput, "fields">): string {
  const from = dayOf(c.fields.start_date?.value);
  const to = dayOf(c.fields.end_date?.value);
  return from || to ? `${from ?? "—"} → ${to ?? "—"}` : "—";
}

export type SummaryLabels = Record<
  "deal" | "partner" | "commission" | "value" | "period" | "progress" | "next" | "lines",
  string
>;

/** Hàng [nhãn, giá trị]; `dealName` / `progressText` do UI dịch. */
export function summaryRows(
  c: SummaryInput,
  partner: string,
  tx: {
    labels: SummaryLabels;
    dealName: (d: ReturnType<typeof dealOf>) => string;
    progress: (done: number, total: number) => string;
  },
): [string, string][] {
  const deal = dealOf(c);
  const prog = progressOf(c.milestones);
  const cur = c.milestones.find((m) => m.id === c.next_milestone_id);
  const raw = c.fields.total_value?.value;
  const value = typeof raw === "number" ? raw : null;
  return [
    [tx.labels.deal, tx.dealName(deal)],
    [tx.labels.partner, partner || "—"],
    deal === "referral"
      ? [tx.labels.commission, commissionText(c)]
      : [tx.labels.value, money(value)],
    [tx.labels.period, periodText(c)],
    [tx.labels.progress, tx.progress(prog.done, prog.total)],
    [tx.labels.next, cur ? `${cur.title} · ${viDate(cur.due_date)}` : "—"],
    [tx.labels.lines, String(c.items.length)],
  ];
}

/** Giá trị "trống" của hàng tóm tắt (đối tác/giá trị/bước tới chưa có) — ẩn cả mục thay vì hiện một dấu "—". */
export const isEmptyRow = ([, v]: [string, string]): boolean => v.trim() === "" || v === "—";

export function nonEmptyRows(rows: [string, string][]): [string, string][] {
  return rows.filter((r) => !isEmptyRow(r));
}
