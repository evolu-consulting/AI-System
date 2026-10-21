// V2-F · HD-04 · mockup `summaryBody`: khối "Tóm tắt hợp đồng" — các điểm chính suy từ dữ liệu đã lưu (loại, đối tác, giá trị, hiệu lực, tiến độ,
// bước hiện tại + hạn) kèm lưu ý do agent đọc (cảnh báo). Chưa có tóm tắt viết bằng AI (V2-G) nên không bịa câu chữ.
import type { AiSummary as AiSummaryT, ContractDetail } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { useGenerateSummary } from "../hooks/use-manage";
import { warningsOf } from "../lib/review";
import { type SummaryInput, summaryRows } from "../lib/summary";

type C = SummaryInput & Pick<ContractDetail, "warnings" | "ai">;

/** V2-G · BA §4.2: tóm tắt 5 mục do AI viết khi đọc hợp đồng (nội dung chính, hạn quan trọng, phạt, thưởng, điều khoản chính). */
function AiSummary({ s }: { s: AiSummaryT }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cdetail.${k}`);
  const lists: [string, string[]][] = [
    ["aiSumDeadlines", s.deadlines],
    ["aiSumPenalties", s.penalties],
    ["aiSumBonuses", s.bonuses],
    ["aiSumClauses", s.clauses],
  ];
  return (
    <div
      className="flex flex-col gap-3 border-b border-rule-soft px-5 py-4"
      data-testid="ai-summary"
    >
      <section data-testid="ai-sum-main">
        <h3 className="text-[12.5px] font-semibold text-dim">{L("aiSumMain")}</h3>
        <p className="mt-0.5 text-[13.5px]">{s.main}</p>
      </section>
      {lists.map(([k, xs]) => (
        <section key={k} data-testid={`ai-sum-${k}`}>
          <h3 className="text-[12.5px] font-semibold text-dim">{L(k)}</h3>
          {xs.length === 0 ? (
            <p className="mt-0.5 text-[13px] text-dim">—</p>
          ) : (
            <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-[13.5px]">
              {xs.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** gap-a1 #17: chưa có tóm tắt AI ⇒ nút "Tạo tóm tắt bằng AI" (usage `contracts.summary`). */
function GenerateSummary({ id }: { id: string }) {
  const { t } = useTranslation();
  const gen = useGenerateSummary(id);
  return (
    <div className="border-b border-rule-soft px-5 py-3">
      <button
        type="button"
        className="btn btn-outline btn-sm"
        data-testid="generate-summary"
        disabled={gen.isPending}
        onClick={() => gen.mutate(undefined)}
      >
        {t(gen.isPending ? "contracts.gapa1.summary.running" : "contracts.gapa1.summary.button")}
      </button>
    </div>
  );
}

export function SummaryPanel({
  c,
  partner,
  generateFor,
}: {
  c: C;
  partner: string;
  /** Id HĐ khi người dùng được ghi, HĐ đã đọc xong, có văn bản nguồn mà chưa có tóm tắt AI. */
  generateFor?: string | undefined;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cdetail.${k}`, o);
  const rows = summaryRows(c, partner, {
    labels: {
      deal: L("sumDeal"),
      partner: L("sumPartner"),
      commission: L("sumCommission"),
      value: L("sumValue"),
      period: L("sumPeriod"),
      progress: L("sumProgress"),
      next: L("sumNext"),
      lines: L("sumLines"),
    },
    dealName: (d) => t(`contracts.cform.dealName.${d}`),
    progress: (done, total) => L("progressCount", { done, total }),
  });
  const warnings = warningsOf(c);
  return (
    <Panel>
      <div className="border-b border-rule-soft px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{L("summary")}</h2>
      </div>
      {c.ai?.summary ? (
        <AiSummary s={c.ai.summary} />
      ) : (
        generateFor && <GenerateSummary id={generateFor} />
      )}
      <dl className="grid grid-cols-2 gap-2 px-5 py-4 max-sm:grid-cols-1" data-testid="summary">
        {rows.map(([k, val]) => (
          <div key={k} className="rounded-[10px] bg-sunk px-3 py-2">
            <dt className="text-[11.5px] text-dim">{k}</dt>
            <dd className="mt-0.5 text-[13.5px] font-semibold break-words">{val}</dd>
          </div>
        ))}
      </dl>
      {warnings.length > 0 && (
        <ul className="mx-5 mb-4 space-y-1 rounded-xl border border-soon-line bg-soon-bg p-3 text-[13px] text-soon">
          {warnings.map((w, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: cảnh báo không có id
            <li key={i}>{w.message}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
