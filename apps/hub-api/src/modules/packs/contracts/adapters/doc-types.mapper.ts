// CR-101 DOC-model: phần `doc` của chi tiết HĐ (json SQL → DTO). Thuần. HĐ NT ⇒ tổng hợp (giai đoạn theo hiệu lực, giá trị = Σ con,
// % hạn mức) + con (cảnh báo ngày ngoài hiệu lực); con ⇒ tham chiếu cha hoặc `{restricted:true}` khi RLS không cho thấy cha.
import type { ContractDoc, DocType, FrameRef } from "@ai/contracts";
import { dateOutsideFrame, frameSummary } from "../domain/doc-types.rules";

export type DocRaw = {
  doc_type: DocType;
  frame_root_id: string | null;
  credit_limit: number | string | null;
  order_terms: string | null;
  frame: FrameRef | null;
  children:
    | {
        id: string;
        doc_type: DocType;
        title: string;
        number: string | null;
        status: string;
        value: number | string | null;
        start_date: string | null;
      }[]
    | null;
};

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

export function toContractDoc(
  d: DocRaw,
  self: { start: string | null; end: string | null },
  today: string,
): ContractDoc {
  const framework = d.doc_type === "framework";
  const creditLimit = num(d.credit_limit);
  const kids = (d.children ?? []).map((k) => ({
    ...k,
    value: num(k.value),
    outside_frame: dateOutsideFrame(k.start_date, self),
  }));
  return {
    doc_type: d.doc_type,
    frame_root_id: d.frame_root_id,
    credit_limit: creditLimit,
    order_terms: d.order_terms,
    frame: d.frame_root_id === null ? null : (d.frame ?? { restricted: true }),
    summary: framework
      ? frameSummary({ start: self.start, end: self.end, creditLimit }, kids, today)
      : null,
    children: framework ? kids : [],
  };
}
