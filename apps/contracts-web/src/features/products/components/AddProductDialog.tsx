// gap-d1 #18 · "Thêm sản phẩm" tay (tên, nhóm, đơn vị, quy cách) ⇒ `POST /products`; xong mở chi tiết SP vừa tạo.
import type { ProductGroup } from "@ai/contracts";
import { useNavigate } from "@tanstack/react-router";
import { type RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import { knownCatalogError, useCreateProduct } from "../hooks/use-catalog";
import { productBody } from "../lib/catalog";
import { FIELD, Field } from "./Field";

const GROUPS: readonly ProductGroup[] = ["goods", "service", "referral"];
const EMPTY = { name: "", group: "goods" as ProductGroup, unit: "", spec: "" };

export function AddProductDialog({ dlg }: { dlg: RefObject<HTMLDialogElement> }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.gapd1.add.${k}`);
  const nav = useNavigate();
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateProduct();
  const body = productBody(f);
  const close = () => {
    setF(EMPTY);
    setErr(null);
    dlg.current?.close();
  };
  const submit = () => {
    if (!body) return;
    setErr(null);
    create.mutate(body, {
      onSuccess: (p) => {
        close();
        void nav({ to: "/products", search: { sp: p.id } });
      },
      onError: (e) => {
        const code = knownCatalogError(e);
        setErr(code ? t(`contracts.gapd1.errors.${code}`) : t("contracts.errors.unknown"));
      },
    });
  };
  return (
    <dialog ref={dlg} className="sheet" onClose={() => setErr(null)}>
      <div className="flex min-w-[min(480px,90vw)] flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">{L("title")}</h2>
        <Field
          id="gd1-p-name"
          label={L("name")}
          value={f.name}
          maxLength={300}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="gd1-p-group" className="text-label text-ink-2">
            {L("group")}
          </label>
          <select
            id="gd1-p-group"
            data-testid="gd1-p-group"
            className={FIELD}
            value={f.group}
            onChange={(e) => setF({ ...f, group: e.target.value as ProductGroup })}
          >
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {t(`contracts.catalog.group.${g}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field
            id="gd1-p-unit"
            label={L("unit")}
            value={f.unit}
            maxLength={40}
            onChange={(e) => setF({ ...f, unit: e.target.value })}
          />
          <Field
            id="gd1-p-spec"
            label={L("spec")}
            value={f.spec}
            maxLength={500}
            onChange={(e) => setF({ ...f, spec: e.target.value })}
          />
        </div>
        {err && (
          <p role="alert" className="text-sm text-late">
            {err}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={close}>
            {t("contracts.psup.close")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="gd1-p-save"
            disabled={!body || create.isPending}
            onClick={submit}
          >
            {L("save")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
