// price-scout · "Cấu hình dò giá" trong tab NCC & giá của SP: giá trị đang áp (mặc định nhóm ⊕ ghi đè riêng), ô nào trùng mặc định nhóm có
// nhãn "theo mặc định nhóm". Có quyền ghi ⇒ sửa + Lưu (chỉ gửi khoá khác mặc định) / "Dùng mặc định nhóm" (PUT {}). Ngoài: chỉ đọc.
import type { PriceScoutProductOut } from "@ai/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorLine, Loading } from "~/components/shared/states";
import { toast } from "~/components/shared/toast";
import { useProductScout, useSaveProductScout } from "../hooks/use-scout";
import { inheritedKeys, overrideOf, type ScoutForm, scoutIssue, toForm } from "../lib/scout";
import { ScoutFields } from "./ScoutFields";
import { ScanLine, UsageLine } from "./ScoutStatus";

function Form({
  productId,
  data,
  write,
}: {
  productId: string;
  data: PriceScoutProductOut;
  write: boolean;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.scout.${k}`);
  const save = useSaveProductScout(productId);
  const [form, setForm] = useState<ScoutForm>(() => toForm(data.effective));
  // Dữ liệu máy chủ đổi (sau Lưu / về mặc định) ⇒ form theo giá trị đang áp.
  useEffect(() => setForm(toForm(data.effective)), [data.effective]);
  const issue = scoutIssue(form);
  const run = (body: Parameters<typeof save.mutate>[0], ok: string) =>
    save.mutate(body, {
      onSuccess: () => toast(ok),
      onError: () => toast(t("contracts.errors.unknown"), "late"),
    });
  return (
    <div className="flex flex-col gap-3">
      <ScoutFields
        idp="scout"
        form={form}
        set={setForm}
        disabled={!write || save.isPending}
        inherited={inheritedKeys(form, data.defaults)}
      />
      {issue && (
        <p role="alert" className="text-sm text-late">
          {t(`contracts.scout.issue.${issue}`)}
        </p>
      )}
      {write && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={save.isPending}
            onClick={() => run({}, L("savedDefault"))}
          >
            {L("useDefault")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="scout-save"
            disabled={save.isPending || issue !== null}
            onClick={() => run(overrideOf(form, data.defaults), L("saved"))}
          >
            {L("save")}
          </button>
        </div>
      )}
    </div>
  );
}

export function ScoutConfigPanel({ productId, write }: { productId: string; write: boolean }) {
  const { t } = useTranslation();
  const q = useProductScout(productId);
  return (
    <section
      aria-labelledby="scout-title"
      data-testid="scout-panel"
      className="flex flex-col gap-3 rounded-xl border border-rule bg-panel p-5"
    >
      <header className="flex flex-col gap-1">
        <h3 id="scout-title" className="text-base font-semibold">
          {t("contracts.scout.title")}
        </h3>
        <p className="text-xs text-dim">{t("contracts.scout.hint")}</p>
      </header>
      {q.isLoading && <Loading />}
      {q.error && <ErrorLine error={q.error} />}
      {q.data && (
        <>
          <UsageLine usage={q.data.usage} />
          <ScanLine data={q.data} />
          <Form productId={productId} data={q.data} write={write} />
        </>
      )}
    </section>
  );
}
