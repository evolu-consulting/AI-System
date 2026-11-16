// Trường theo loại bài (mockup `.cfields`): Cần bán = hàng hoá, số lượng, giá/liên hệ; Cần mua = + khu vực, ngày cần.

import { DateInput } from "@ai/web-kit/ui/DateInput";
import { Input } from "@ai/web-kit/ui/kit/input";
import { OptionSelect } from "~/shared/ui/OptionSelect";
import type { Draft } from "../domain/compose";
import { t } from "../i18n";

function F({
  label,
  err,
  children,
}: {
  label: string;
  err?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="fgroup">
      {children}
      {err && (
        <div className="ferr" role="alert">
          {err}
        </div>
      )}
      <span style={{ position: "absolute", left: -9999 }}>{label}</span>
    </div>
  );
}

export function DraftFields({
  draft,
  set,
  errors,
  cats,
}: {
  draft: Draft;
  set: (d: Draft) => void;
  errors: Record<string, string>;
  cats?: string[];
}) {
  const on = (k: keyof Draft) => (e: { target: { value: string } }) =>
    set({ ...draft, [k]: e.target.value });
  const buy = draft.type === "buy";
  return (
    <>
      <div className="cfields">
        <F label={t("community.draft.product")} err={errors.product}>
          <Input
            aria-label={t("community.draft.product")}
            placeholder={t("community.draft.product")}
            value={draft.product}
            onChange={on("product")}
          />
        </F>
        <F label={t("community.draft.qty")} err={errors.qty}>
          <Input
            aria-label={t("community.draft.qty")}
            placeholder={t("community.draft.qty")}
            value={draft.qty}
            onChange={on("qty")}
          />
        </F>
        <F label={t("community.draft.price")} err={errors.price}>
          {buy ? (
            <Input
              aria-label={t("community.draft.budget")}
              placeholder={t("community.draft.budgetHint")}
              title={t("community.draft.budgetHint")}
              value={draft.budget}
              onChange={on("budget")}
            />
          ) : (
            <Input
              aria-label={t("community.draft.price")}
              placeholder={t("community.draft.priceHint")}
              title={t("community.draft.priceHint")}
              value={draft.price}
              onChange={on("price")}
            />
          )}
        </F>
      </div>
      <div className="cfields">
        <F label={t("community.draft.area")} err={errors.area}>
          <Input
            aria-label={t("community.draft.area")}
            placeholder={buy ? t("community.draft.areaRequired") : t("community.draft.area")}
            value={draft.area}
            onChange={on("area")}
          />
        </F>
        {buy && (
          <F label={t("community.draft.neededBy")} err={errors.neededBy}>
            <DateInput
              className="field"
              aria-label={t("community.draft.neededBy")}
              value={draft.neededBy}
              onChange={on("neededBy")}
            />
          </F>
        )}
        {cats && cats.length > 0 && (
          <F label={t("community.draft.cat")}>
            <OptionSelect
              aria-label={t("community.draft.cat")}
              value={draft.cats[0] ?? ""}
              onValueChange={(v) => set({ ...draft, cats: v ? [v] : [] })}
            >
              <option value="">{t("community.draft.catPlaceholder")}</option>
              {cats.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </OptionSelect>
          </F>
        )}
      </div>
    </>
  );
}
