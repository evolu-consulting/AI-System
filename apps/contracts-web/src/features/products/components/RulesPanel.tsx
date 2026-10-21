// gap-d1 #20 · tab "Nhận diện" của chi tiết SP: quy tắc nhận diện dòng hợp đồng (cụm chữ ⇒ SP / thành phần) trên
// `POST /products/:id/rules` và `DELETE /products/:id/rules/:ruleId`.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorLine, Loading } from "~/components/shared/states";
import { useMe } from "~/features/pack-state/hooks/use-me";
import {
  knownCatalogError,
  useAddRule,
  useCatalogProduct,
  useDeleteRule,
} from "../hooks/use-catalog";
import { ruleBody } from "../lib/catalog";
import { FIELD } from "./Field";

export function RulesPanel({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.gapd1.rules.${k}`);
  const { write } = useMe();
  const q = useCatalogProduct(productId);
  const add = useAddRule(productId);
  const del = useDeleteRule(productId);
  const [pattern, setPattern] = useState("");
  const [comp, setComp] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const p = q.data;
  const body = ruleBody(pattern, comp);
  const fail = (e: unknown) => {
    const code = knownCatalogError(e);
    setErr(code ? t(`contracts.gapd1.errors.${code}`) : t("contracts.errors.unknown"));
  };
  return (
    <div className="flex flex-col gap-3 p-4 text-base leading-[1.55]">
      <div>
        <h3 className="text-base font-semibold">{L("title")}</h3>
        <p className="text-sm text-dim">{L("hint")}</p>
      </div>
      {p.rules.length === 0 ? (
        <p className="text-sm text-dim">{L("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {p.rules.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-lg border border-rule-soft px-3 py-2 text-sm"
            >
              <b>{r.pattern}</b>
              <span className="text-dim">
                {r.component_id
                  ? `→ ${p.components.find((c) => c.id === r.component_id)?.name ?? "—"}`
                  : L("wholeProduct")}
              </span>
              {write && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm ml-auto"
                  disabled={del.isPending}
                  onClick={() => del.mutate(r.id, { onError: fail })}
                >
                  {L("remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {write && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[220px] flex-1 flex-col gap-1">
            <label htmlFor="gd1-r-pattern" className="text-label text-ink-2">
              {L("pattern")}
            </label>
            <input
              id="gd1-r-pattern"
              data-testid="gd1-r-pattern"
              className={FIELD}
              value={pattern}
              maxLength={100}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
          {p.components.length > 1 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="gd1-r-comp" className="text-label text-ink-2">
                {L("component")}
              </label>
              <select
                id="gd1-r-comp"
                className={FIELD}
                value={comp}
                onChange={(e) => setComp(e.target.value)}
              >
                <option value="">{L("wholeProduct")}</option>
                {p.components.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="gd1-r-add"
            disabled={!body || add.isPending}
            onClick={() =>
              body &&
              add.mutate(body, {
                onSuccess: () => {
                  setPattern("");
                  setErr(null);
                },
                onError: fail,
              })
            }
          >
            {L("add")}
          </button>
        </div>
      )}
      {err && (
        <p role="alert" className="text-sm text-late">
          {err}
        </p>
      )}
    </div>
  );
}
