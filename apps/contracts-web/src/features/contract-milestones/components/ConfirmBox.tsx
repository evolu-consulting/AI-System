// V2-F · HD-04 · mockup `confirmBox`: "Xác nhận xong" hỏi NGÀY thực tế; mốc trễ hạn (ngày thực tế > hạn) hỏi thêm LỖI của ai
// (đối tác / mình / chưa rõ) — chỉ lỗi đối tác trừ điểm (V2-E). Gửi `POST /obligations/:id/settle`.
import type { ContractDeal, Milestone } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PillRadio } from "~/components/shared/seg-button";
import { toast } from "~/components/shared/toast";
import { type Fault, useMilestoneWrites } from "../hooks/use-milestone-writes";
import type { LinesEdit } from "../lib/delivery-lines";
import { daysBetween } from "../lib/timeline";
import { DeliveryLines } from "./DeliveryLines";

const FAULTS: readonly Fault[] = ["partner", "ours", "unknown"];

export function ConfirmBox({
  m,
  today,
  partner,
  deal,
  editable = true,
  onDone,
  onCancel,
  onError,
}: {
  m: Milestone;
  today: string;
  /** Loại HĐ (bảng "Giao đợt này" + kiểm tồn cho HĐ Bán). */
  deal?: ContractDeal;
  /** HĐ đã khoá ⇒ không sửa được bảng SL. */
  editable?: boolean;
  /** Tên ngắn của đối tác (nhãn lựa chọn lỗi). */
  partner: string;
  onDone: () => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const { settleMilestone, editMilestone } = useMilestoneWrites();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cdetail.${k}`, o);
  const [edit, setEdit] = useState<LinesEdit | null>(null);
  const [at, setAt] = useState(today);
  const [fault, setFault] = useState<Fault>("partner");
  const [busy, setBusy] = useState(false);
  const late = at ? daysBetween(m.due_date, at) : 0;
  async function go() {
    if (!at || edit?.bad) return;
    setBusy(true);
    try {
      // SL đã sửa so với bản tính sẵn ⇒ lưu bảng SL của mốc trước, rồi xác nhận (server dùng đúng bảng đó).
      if (edit?.dirty) await editMilestone(m.id, { items: edit.items });
      const res = (await settleMilestone(m.id, { at, ...(late > 0 ? { fault } : {}) })) as {
        delivery?: { overdrawn?: { name: string; need: string; have: string }[] };
      } | null;
      const over = res?.delivery?.overdrawn;
      if (over?.length)
        toast(
          L("overdrawnDone", {
            list: over.map((x) => `${x.name} (${x.need} / ${x.have})`).join("; "),
          }),
          "late",
        );
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
      {m.kind === "delivery" && deal && (
        <DeliveryLines id={m.id} deal={deal} editable={editable} onEdit={setEdit} />
      )}
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
          disabled={busy || !at || edit?.bad === true}
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
