// CR-097 G2 · GD-FR-01/02: sửa nháp (lưu nháp, xoá nháp) và ghi sổ — xác nhận, rồi hộp kho trước → sau theo `stock` của API.
// Lỗi 409 TRANSACTION_STOCK / 422 TRANSACTION_INVALID hiện thông điệp máy chủ ngay dưới form.
import type { TransactionActionOut, TransactionDetail } from "@ai/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { vnd } from "~/components/shared/format";
import { toast } from "~/components/shared/toast";
import { deleteTx, patchTx, postTx } from "../api";
import { useTxRefs } from "../hooks/use-tx-refs";
import { useTxRun } from "../hooks/use-tx-run";
import {
  type FormError,
  formErrorText,
  formFromDetail,
  type TxForm,
  toDraft,
} from "../lib/transactions";
import { TxFormView } from "./TxForm";

export function DraftEditor({
  tx,
  write,
  onPosted,
}: {
  tx: TransactionDetail;
  write: boolean;
  /** Trang giữ hộp kết quả (sau ghi sổ chi tiết chuyển sang chế độ xem, DraftEditor bị gỡ). */
  onPosted: (r: TransactionActionOut, labels: ReadonlyMap<string, string>) => void;
}) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const refs = useTxRefs();
  const { busy, error, run } = useTxRun();
  const [form, setForm] = useState<TxForm>(() => formFromDetail(tx));
  const [fe, setFe] = useState<FormError | null>(null);
  const [dirty, setDirty] = useState(false);

  const change = (f: TxForm) => {
    setForm(f);
    setDirty(true);
  };
  async function save(): Promise<boolean> {
    const d = toDraft(form);
    if (!d.ok) {
      setFe(d.error);
      return false;
    }
    setFe(null);
    const r = await run(() => patchTx(tx.id, d.body));
    if (!r) return false;
    setDirty(false);
    toast(t("contracts.txn.saved"));
    return true;
  }
  async function remove() {
    const ok = await confirmDialog({
      title: t("contracts.txn.delete.title"),
      body: t("contracts.txn.delete.body"),
      confirmLabel: t("contracts.txn.delete.ok"),
      danger: true,
    });
    if (!ok) return;
    const r = await run(() => deleteTx(tx.id).then(() => true));
    if (r) {
      toast(t("contracts.txn.deleted"));
      void nav({ to: "/transactions" });
    }
  }
  async function post() {
    const ok = await confirmDialog({
      title: t("contracts.txn.post.title"),
      body: t("contracts.txn.post.body", { total: vnd(tx.total), n: tx.lines.length }),
      confirmLabel: t("contracts.txn.post.ok"),
    });
    if (!ok) return;
    const r = await run(() => postTx(tx.id));
    if (r) onPosted(r, refs.labels);
  }
  if (!write) return null;
  return (
    <TxFormView
      form={form}
      onChange={change}
      products={refs.products}
      contractOptions={refs.contractOptions}
      error={fe}
      message={fe ? formErrorText(fe, t) : error}
      actions={
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
            data-testid="tx-save"
          >
            {t("contracts.txn.saveDraft")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || dirty}
            title={dirty ? t("contracts.txn.post.saveFirst") : undefined}
            onClick={() => void post()}
            data-testid="tx-post"
          >
            {t("contracts.txn.post.button")}
          </button>
          <button
            type="button"
            className="btn ml-auto text-late"
            disabled={busy}
            onClick={() => void remove()}
            data-testid="tx-delete"
          >
            {t("contracts.txn.delete.button")}
          </button>
        </>
      }
    />
  );
}
