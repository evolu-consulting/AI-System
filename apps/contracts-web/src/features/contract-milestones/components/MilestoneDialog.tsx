// V2-F · HD-11 · mockup `openMsEd`: hộp "Thêm mốc" / "Sửa mốc" — loại mốc (7 loại), hạn, tên, việc của ai, SL (chỉ Giao hàng), số tiền
// (chỉ Thu tiền / Thanh toán / Nhận hoa hồng). Sửa/xoá chỉ cho mốc CHƯA xác nhận (mốc đã xác nhận giữ nguyên để không đổi điểm đã tính).
import type { ContractDeal, Milestone } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PillRadio } from "~/components/shared/seg-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useMilestoneWrites } from "../hooks/use-milestone-writes";
import { bodyOf, draftOfMilestone, type MsDraft, newDraft, withKind } from "../lib/milestone-form";
import { KINDS, type MilestoneKind, MONEY_KINDS } from "../lib/timeline";

type Props = {
  contractId: string;
  deal: ContractDeal;
  partner: string;
  /** Có ⇒ sửa mốc này; vắng ⇒ thêm mốc mới. */
  edit: Milestone | null;
  today: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (e: unknown) => void;
};

function Field({
  id,
  label,
  children,
  wide,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1 text-[13px] ${wide ? "col-span-2 max-sm:col-span-1" : ""}`}
    >
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

export function MilestoneDialog({
  contractId,
  deal,
  partner,
  edit,
  today,
  onClose,
  onSaved,
  onError,
}: Props) {
  const { t } = useTranslation();
  const { addMilestone, editMilestone, removeMilestone } = useMilestoneWrites();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cdetail.${k}`, o);
  const [d, setD] = useState<MsDraft>(() =>
    edit ? draftOfMilestone(edit) : newDraft(deal, today, L("kind.delivery")),
  );
  const [titleEdited, setTitleEdited] = useState(!!edit);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<string | null>(null);
  const set = (p: Partial<MsDraft>) => setD((s) => ({ ...s, ...p }));

  /** Chạy một lệnh ghi; thành công ⇒ đóng + tải lại, lỗi ⇒ báo ở trang. */
  async function run(job: () => Promise<unknown>) {
    setBusy(true);
    setBad(null);
    try {
      await job();
      onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  function save() {
    const r = bodyOf(d, !!edit);
    if ("err" in r) return setBad(L(r.err));
    void run(() => (edit ? editMilestone(edit.id, r.ok) : addMilestone(contractId, r.ok)));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={edit ? L("editMilestone") : L("addMilestone")}>
        <DialogHeader>
          <DialogTitle>{edit ? L("editMilestone") : L("addMilestone")}</DialogTitle>
          <DialogDescription className="sr-only">{L("milestoneHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <Field id="ms-kind" label={L("kindLabel")}>
            <select
              id="ms-kind"
              value={d.kind}
              onChange={(e) => {
                const k = e.target.value as MilestoneKind;
                setD((s) => withKind(s, k, deal, L(`kind.${k}`), titleEdited));
              }}
              className="field"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {L(`kind.${k}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="ms-due" label={`${L("dueLabel")} *`}>
            <input
              id="ms-due"
              type="date"
              value={d.due}
              onChange={(e) => set({ due: e.target.value })}
              className="field font-mono"
            />
          </Field>
          <Field id="ms-title" label={`${L("titleLabel")} *`} wide>
            <input
              id="ms-title"
              value={d.title}
              onChange={(e) => {
                setTitleEdited(true);
                set({ title: e.target.value });
              }}
              placeholder={L("titlePh")}
              className="field"
            />
          </Field>
          <div className="col-span-2 flex flex-col gap-1 text-[13px] max-sm:col-span-1">
            <span id="ms-owner">{L("ownerLabel")}</span>
            <div role="radiogroup" aria-labelledby="ms-owner" className="flex gap-1.5">
              <PillRadio checked={d.owner === "ours"} onClick={() => set({ owner: "ours" })}>
                {L("ownerOurs")}
              </PillRadio>
              <PillRadio checked={d.owner === "partner"} onClick={() => set({ owner: "partner" })}>
                {partner}
              </PillRadio>
            </div>
          </div>
          {d.kind === "delivery" && (
            <Field id="ms-pct" label={L("pctLabel")}>
              <input
                id="ms-pct"
                inputMode="decimal"
                value={d.pct}
                onChange={(e) => set({ pct: e.target.value, qty: e.target.value ? "" : d.qty })}
                placeholder={L("pctPh")}
                className="field font-mono"
              />
              <span className="text-caption text-dim">{L("pctHint")}</span>
            </Field>
          )}
          {d.kind === "delivery" && (
            <Field id="ms-qty" label={L("qtyLabel")}>
              <input
                id="ms-qty"
                inputMode="decimal"
                value={d.qty}
                disabled={d.pct.trim() !== ""}
                onChange={(e) => set({ qty: e.target.value })}
                placeholder={L("qtyPh")}
                className="field font-mono"
              />
            </Field>
          )}
          {MONEY_KINDS.has(d.kind) && (
            <Field id="ms-amount" label={L("amountLabel")}>
              <input
                id="ms-amount"
                inputMode="numeric"
                value={d.amount}
                onChange={(e) => set({ amount: e.target.value })}
                placeholder={L("amountPh")}
                className="field font-mono"
              />
            </Field>
          )}
        </div>
        {bad && (
          <p role="alert" className="text-sm text-late">
            {bad}
          </p>
        )}
        <DialogFooter className="items-center gap-2">
          {edit && (
            <button
              type="button"
              className="btn btn-quiet btn-sm mr-auto text-late"
              disabled={busy}
              onClick={() => void run(() => removeMilestone(edit.id))}
            >
              {L("deleteMilestone")}
            </button>
          )}
          <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
            {t("contracts.common.cancel")}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
            {edit ? L("saveMilestone") : L("addMilestone")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
