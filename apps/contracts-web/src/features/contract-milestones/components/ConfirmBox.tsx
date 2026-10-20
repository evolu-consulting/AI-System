// V2-F · HD-04 · mockup `confirmBox`: "Xác nhận xong" hỏi NGÀY thực tế; mốc trễ hạn (ngày thực tế > hạn) hỏi thêm LỖI của ai
// (đối tác / mình / chưa rõ) — chỉ lỗi đối tác trừ điểm (V2-E). Gửi `POST /obligations/:id/settle`.
import type { Milestone } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PillRadio } from "~/components/shared/seg-button";
import { type Fault, settleMilestone } from "../api";
import { daysBetween } from "../lib/timeline";

const FAULTS: readonly Fault[] = ["partner", "ours", "unknown"];

export function ConfirmBox({
  m,
  today,
  partner,
  onDone,
  onCancel,
  onError,
}: {
  m: Milestone;
  today: string;
  /** Tên ngắn của đối tác (nhãn lựa chọn lỗi). */
  partner: string;
  onDone: () => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cdetail.${k}`, o);
  const [at, setAt] = useState(today);
  const [fault, setFault] = useState<Fault>("partner");
  const [busy, setBusy] = useState(false);
  const late = at ? daysBetween(m.due_date, at) : 0;
  async function go() {
    if (!at) return;
    setBusy(true);
    try {
      await settleMilestone(m.id, { at, ...(late > 0 ? { fault } : {}) });
      onDone();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="mt-2.5 flex flex-col gap-3 rounded-[10px] border border-rule bg-panel p-3.5"
      data-testid="confirm-box"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-[13px]">
          <label htmlFor={`done-${m.id}`}>{L("doneDate")}</label>
          <input
            id={`done-${m.id}`}
            type="date"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="field w-[170px] font-mono"
          />
        </div>
        {late > 0 && (
          <fieldset className="flex flex-col gap-1 text-[13px]">
            <legend className="mb-1">{L("faultAsk", { n: late })}</legend>
            <div className="flex gap-1.5" role="radiogroup" aria-label={L("faultAsk", { n: late })}>
              {FAULTS.map((fl) => (
                <PillRadio key={fl} checked={fault === fl} onClick={() => setFault(fl)}>
                  {L(`fault.${fl}`, { partner })}
                </PillRadio>
              ))}
            </div>
          </fieldset>
        )}
      </div>
      <p className="text-[12.5px] text-dim">
        {late > 0
          ? L("impactLate", { n: late })
          : late < 0
            ? L("impactEarly", { n: -late })
            : L("impactOnTime")}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || !at}
          onClick={() => void go()}
        >
          {L("confirmOk")}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>
          {t("contracts.common.cancel")}
        </button>
      </div>
    </div>
  );
}
