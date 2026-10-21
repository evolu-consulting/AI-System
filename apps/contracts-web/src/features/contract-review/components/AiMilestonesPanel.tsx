// V2-G · BA §4.2: cột phải ở bước xác nhận — các mốc AI tìm thấy trong văn bản (loại, tên, hạn, số tiền, trích dẫn); bỏ chọn mốc sai, sửa hạn.
// Hạn để trống (AI không thấy ngày) hiện theo ngày hợp đồng (kết thúc ?? bắt đầu ?? hôm nay) và gửi đúng ngày đó khi Lưu.
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { Tag } from "~/components/shared/tag";
import type { FormState } from "~/features/contract-form/lib/form-model";
import { fallbackDue, type MsRow } from "~/features/contract-form/lib/review-model";
import { QuoteLine } from "~/features/contract-source/components/QuoteLine";

export function AiMilestonesPanel({
  rows,
  form,
  today,
  disabled,
  onChange,
}: {
  rows: readonly MsRow[];
  form: Pick<FormState, "end_date" | "start_date">;
  today: string;
  disabled: boolean;
  onChange: (i: number, p: Partial<MsRow>) => void;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cdetail.${k}`, o);
  return (
    <Panel>
      <div className="border-b border-rule-soft px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{L("aiMsTitle")}</h2>
        <p className="mt-0.5 text-[12.5px] text-dim">{L("aiMsHint")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-dim">{L("aiMsEmpty")}</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-rule-soft p-0" data-testid="ai-milestones">
          {rows.map((r, i) => {
            const title = r.title || L(`kind.${r.kind}`);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: mốc AI chưa có id
              <li key={i} className="flex flex-col gap-1.5 px-5 py-3" data-keep={r.keep}>
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={r.keep}
                    disabled={disabled}
                    aria-label={L("aiMsKeep", { title })}
                    onChange={(e) => onChange(i, { keep: e.target.checked })}
                  />
                  <b className="text-[13.5px]">{title}</b>
                  <Tag tone="grey">{L(`kind.${r.kind}`)}</Tag>
                  {!r.verified && <Tag tone="soon">{L("aiMsUnverified")}</Tag>}
                  {r.amount !== null && (
                    <span className="ml-auto font-mono text-[13px]">{vnd(r.amount)} đ</span>
                  )}
                </div>
                <input
                  type="date"
                  className="field h-9 w-[170px]"
                  aria-label={L("aiMsDue", { title })}
                  disabled={disabled || !r.keep}
                  value={r.due_date ?? fallbackDue(form, today)}
                  onChange={(e) => onChange(i, { due_date: e.target.value || null })}
                />
                {r.quote && <QuoteLine quote={r.quote} />}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
