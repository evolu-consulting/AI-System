// CR-097 G2 · GD-FR-01: tạo nháp giao dịch (`/transactions/new`, `?contract=` điền sẵn HĐ liên kết) — lưu xong mở chi tiết nháp.
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead } from "~/components/shared/layout";
import { toast } from "~/components/shared/toast";
import { createTx } from "../api";
import { TxFormView } from "../components/TxForm";
import { useTxRefs } from "../hooks/use-tx-refs";
import { useTxRun } from "../hooks/use-tx-run";
import { emptyForm, type FormError, formErrorText, toDraft } from "../lib/transactions";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });

export function TransactionNewPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const search = useSearch({ strict: false }) as { contract?: string };
  const refs = useTxRefs();
  const { busy, error, run } = useTxRun();
  const [form, setForm] = useState(() => ({
    ...emptyForm(today()),
    contract_id: search.contract ?? "",
  }));
  const [fe, setFe] = useState<FormError | null>(null);
  async function save() {
    const d = toDraft(form);
    if (!d.ok) return setFe(d.error);
    setFe(null);
    const r = await run(() => createTx(d.body));
    if (r) {
      toast(t("contracts.txn.saved"));
      void nav({ to: "/transactions/$id", params: { id: r.id } });
    }
  }
  return (
    <div className="text-base leading-[1.55]">
      <PageHead title={t("contracts.txn.new")} />
      <TxFormView
        form={form}
        onChange={setForm}
        products={refs.products}
        contractOptions={refs.contractOptions}
        error={fe}
        message={fe ? formErrorText(fe, t) : error}
        actions={
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void save()}
              data-testid="tx-save"
            >
              {t("contracts.txn.saveDraft")}
            </button>
            <button type="button" className="btn" onClick={() => void nav({ to: "/transactions" })}>
              {t("contracts.common.cancel")}
            </button>
          </>
        }
      />
    </div>
  );
}
