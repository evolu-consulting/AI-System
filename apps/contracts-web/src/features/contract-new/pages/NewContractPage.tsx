// HD-FR-26 · S04 · Q15 · D-02: "Thêm hợp đồng (nhập tay)" — port `NewContractPage.tsx:36-120` (cùng ô, nhãn, bố cục, thông báo
// số không đọc được). Lưu ⇒ `POST /pack/contracts/contracts/manual` ⇒ mở màn kiểm/sửa của HĐ mới. Điền sẵn của trợ lý: HD6.
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { saveErrorText } from "~/features/contract-review/lib/save-error";
import { createManualContract } from "../api";
import { ItemRows } from "../components/ItemRows";
import { EMPTY_FORM, type NewForm, readNumbers, toRequest } from "../lib/new-form";

const FIELD = "field mt-1";
type TextKey = Exclude<keyof NewForm, "items" | "direction">;

export function NewContractPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState<NewForm>(EMPTY_FORM);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const L = (k: string) => t(`contracts.newContract.${k}`);
  const set =
    (k: keyof NewForm) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF({ ...f, [k]: e.target.value });
  const input = (k: TextKey, label: string, extra: Record<string, unknown> = {}, cls = FIELD) => (
    <label className="text-[13px]">
      {L(label)}
      <input name={k} value={f[k]} onChange={set(k)} className={cls} {...extra} />
    </label>
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = readNumbers(f);
    if (n.bad.length) {
      const names = n.bad.map((b) => t(`contracts.newContract.bad.${b.key}`, { name: b.name }));
      return setErr(t("contracts.newContract.badNumbers", { list: names.join(", ") }));
    }
    setBusy(true);
    setErr(null);
    try {
      const rec = await createManualContract(toRequest(f, n));
      await qc.invalidateQueries();
      await nav({ to: "/contracts/$id", params: { id: rec.id } });
    } catch (x) {
      setErr(saveErrorText(x, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    // Thân trang như mgmt-app (`index.css:78-82`: 16 px, line-height 1.55) — Shell giữ thang chữ của nó.
    <div className="text-base leading-[1.55]">
      <PageHead
        crumb={
          <Link to="/contracts" className="hover:underline">
            {t("contracts.review.back")}
          </Link>
        }
        title={L("title")}
        lead={L("lead")}
      />
      <Panel className="p-5">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <label className="text-[13px]">
              {L("direction")}
              <select
                name="direction"
                value={f.direction}
                onChange={set("direction")}
                className={FIELD}
              >
                <option value="purchase">{L("purchase")}</option>
                <option value="sale">{L("sale")}</option>
              </select>
            </label>
            {input("number", "number")}
            <label className="col-span-2 text-[13px] max-sm:col-span-1">
              {L("contractTitle")}
              <input
                name="title"
                required
                value={f.title}
                onChange={set("title")}
                className={FIELD}
                placeholder={L("titlePlaceholder")}
              />
            </label>
            {input("partner_name", "partner", { required: true })}
            {input(
              "partner_tax_id",
              "partnerTaxId",
              { inputMode: "numeric" },
              `${FIELD} font-mono`,
            )}
            {input("partner_signer", "partnerSigner", {
              placeholder: L("partnerSignerPlaceholder"),
            })}
            {input("our_signer", "ourSigner", { placeholder: L("ourSignerPlaceholder") })}
            {input("start_date", "startDate", { type: "date" })}
            {input("end_date", "endDate", { type: "date" })}
            {input("notice_days", "noticeDays", { inputMode: "numeric" }, `${FIELD} font-mono`)}
            {input("total_value", "totalValue", { inputMode: "numeric" }, `${FIELD} font-mono`)}
            <label className="col-span-2 text-[13px] max-sm:col-span-1">
              {L("paymentTerms")}
              <textarea
                name="payment_terms"
                rows={2}
                value={f.payment_terms}
                onChange={set("payment_terms")}
                className={`${FIELD} h-auto py-2`}
              />
            </label>
          </div>
          <ItemRows items={f.items} onChange={(items) => setF({ ...f, items })} />
          {err && (
            <p role="alert" className="text-sm text-late">
              {err}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Link to="/contracts" className="btn btn-quiet">
              {t("contracts.common.cancel")}
            </Link>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? L("saving") : L("save")}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
