// V2-L · CD-01: mục "Công ty" — tên, tên ứng dụng, logo ≤ 1 MB, màu chủ đạo (6), giao diện; tên + MST của chính công ty (V2-G đoán
// Mua/Bán); cờ duyệt hợp đồng (V2-A). Sửa là sidebar/menu/nút đổi ngay (bản xem thử ở `brandStore`).
import { COMPANY_ACCENTS, COMPANY_LOGO_MAX_BYTES, type CompanyIn, MST_RE } from "@ai/contracts";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { BrandMark } from "~/features/shell/components/BrandMark";
import { ACCENTS } from "../lib/brand";
import { FIELD, Panel, Row, Seg, Switch } from "./controls";

const lines = (v: string) =>
  v
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export function CompanyPane({
  value: c,
  tenantName,
  set,
}: {
  value: CompanyIn;
  tenantName: string;
  set: (c: CompanyIn) => void;
}) {
  const { t } = useTranslation();
  const file = useRef<HTMLInputElement>(null);
  const s = (k: string, o?: Record<string, string>) => t(`contracts.settings.co.${k}`, o);
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > COMPANY_LOGO_MAX_BYTES) return toast(s("logoBig"), "late");
    const r = new FileReader();
    r.onload = () => set({ ...c, logo: String(r.result) });
    r.readAsDataURL(f);
  };
  const badMst = c.own_tax_ids.filter((x) => !MST_RE.test(x));
  return (
    <>
      <Panel>
        <Row label={s("name")} htmlFor="co-name">
          <input
            id="co-name"
            className={FIELD}
            maxLength={60}
            value={c.name ?? ""}
            placeholder={tenantName}
            onChange={(e) => set({ ...c, name: e.target.value || null })}
          />
        </Row>
        <Row label={s("app")} htmlFor="co-app">
          <input
            id="co-app"
            className={FIELD}
            maxLength={40}
            value={c.app_name ?? ""}
            placeholder={t("contracts.app.name")}
            onChange={(e) => set({ ...c, app_name: e.target.value || null })}
          />
        </Row>
        <Row label={s("logo")}>
          <div className="flex flex-wrap items-center gap-3">
            <BrandMark name={c.name ?? tenantName} logo={c.logo} className="h-14 w-14 text-2xl" />
            <input
              ref={file}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              data-testid="logo-file"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="h-9 rounded-lg border border-act px-3 text-label text-act hover:bg-act-soft"
              onClick={() => file.current?.click()}
            >
              {c.logo ? s("logoChange") : s("logoUpload")}
            </button>
            {c.logo && (
              <button
                type="button"
                className="h-9 px-2 text-label text-dim hover:text-ink"
                onClick={() => set({ ...c, logo: null })}
              >
                {s("logoRemove")}
              </button>
            )}
            <p className="basis-full text-caption text-dim">{s("logoHint")}</p>
          </div>
        </Row>
        <Row label={s("accent")}>
          <div role="radiogroup" aria-label={s("accent")} className="flex flex-wrap gap-2">
            {COMPANY_ACCENTS.map((a) => (
              // biome-ignore lint/a11y/useSemanticElements: nút chọn màu dạng radio theo mockup
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={c.accent === a}
                onClick={() => set({ ...c, accent: a })}
                style={{ "--sw": ACCENTS[a].l[0] } as React.CSSProperties}
                className={`inline-flex h-9 items-center gap-2 rounded-full border bg-panel px-3 text-[13px] ${c.accent === a ? "border-[var(--sw)] shadow-[0_0_0_1px_var(--sw)]" : "border-rule"}`}
              >
                <i className="h-5 w-5 rounded-full bg-[var(--sw)]" />
                {t(`contracts.gape.accent.${a}`)}
              </button>
            ))}
          </div>
        </Row>
        <Row label={s("theme")}>
          <Seg
            label={s("theme")}
            value={c.theme}
            onChange={(theme) => set({ ...c, theme })}
            options={[
              ["auto", s("themeAuto")],
              ["light", s("themeLight")],
              ["dark", s("themeDark")],
            ]}
          />
        </Row>
      </Panel>
      <Panel title={s("ownTitle")} sub={s("ownHint")}>
        <Row label={s("ownNames")} htmlFor="co-own-names">
          <textarea
            id="co-own-names"
            rows={3}
            className={`${FIELD} h-auto py-2`}
            value={c.own_names.join("\n")}
            onChange={(e) => set({ ...c, own_names: lines(e.target.value).slice(0, 10) })}
          />
        </Row>
        <Row label={s("ownTax")} htmlFor="co-own-tax">
          <textarea
            id="co-own-tax"
            rows={2}
            className={`${FIELD} h-auto py-2`}
            value={c.own_tax_ids.join("\n")}
            onChange={(e) => set({ ...c, own_tax_ids: lines(e.target.value).slice(0, 10) })}
          />
          {badMst.length > 0 && (
            <p role="alert" className="mt-1 text-caption text-late">
              {s("taxBad", { list: badMst.join(", ") })}
            </p>
          )}
        </Row>
      </Panel>
      <Panel title={s("approvalTitle")}>
        <Row label={s("approval")}>
          <div className="flex items-center gap-3">
            <Switch
              checked={c.approval_enabled}
              onChange={(v) => set({ ...c, approval_enabled: v })}
              label={s("approval")}
            />
            <span className="text-caption text-dim">
              {c.approval_enabled ? s("approvalOn") : s("approvalOff")}
            </span>
          </div>
        </Row>
      </Panel>
    </>
  );
}
