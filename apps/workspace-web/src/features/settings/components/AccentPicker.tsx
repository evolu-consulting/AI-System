// CR-138 Q8 · màu chủ đạo công ty: 12 màu đặt sẵn (dải theo sắc độ) + ô «Màu tự chọn» (#RRGGBB) có xem trước sáng/tối và kiểm tương phản
// WCAG AA (chữ trắng trên nền nút ≥ 4.5:1). Không đạt ⇒ báo lý do + gợi ý màu gần nhất đạt chuẩn, và nút Lưu bị chặn (`firstIssue`).
import {
  COMPANY_ACCENTS,
  checkAccent,
  isAccentHex,
  isAccentPreset,
} from "@ai/contracts/pack-contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Btn } from "~/components/ui/Btn";
import { accentIssue, normalizeHex } from "../lib/accent-input";
import { accentPalette, accentSwatch } from "../lib/brand";
import { FIELD } from "./controls";

function Sample({ bg, fg, act, label }: { bg: string; fg: string; act: string; label: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        className="flex items-center gap-3 rounded-lg border border-rule p-2"
        style={{ background: bg }}
      >
        <span
          className="inline-flex h-8 items-center whitespace-nowrap rounded-md px-3 text-label font-semibold"
          style={{ background: act, color: fg }}
        >
          {t("contracts.settings.co.accentPreviewBtn")}
        </span>
        <span className="whitespace-nowrap text-label font-medium underline" style={{ color: act }}>
          {t("contracts.settings.co.accentPreviewLink")}
        </span>
      </div>
      <span className="text-caption text-dim">{label}</span>
    </div>
  );
}

function Preview({ accent }: { accent: string }) {
  const { t } = useTranslation();
  const p = accentPalette(accent);
  return (
    <fieldset
      className="m-0 grid min-w-0 gap-2 border-0 p-0 sm:grid-cols-2"
      data-testid="accent-preview"
      aria-label={t("contracts.settings.co.accentPreview")}
    >
      <Sample
        bg="#ffffff"
        fg="#ffffff"
        act={p.l[0] as string}
        label={t("contracts.settings.co.themeLight")}
      />
      <Sample
        bg="#17182a"
        fg="#0e0f1c"
        act={p.d[0] as string}
        label={t("contracts.settings.co.themeDark")}
      />
    </fieldset>
  );
}

export function AccentPicker({ value, set }: { value: string; set: (accent: string) => void }) {
  const { t } = useTranslation();
  const s = (k: string, o?: Record<string, string>) => t(`contracts.settings.co.${k}`, o);
  const [raw, setRaw] = useState(isAccentPreset(value) ? "" : value);
  useEffect(() => {
    // Bản nháp đổi từ ngoài (Bỏ thay đổi / Khôi phục / chọn màu đặt sẵn) ⇒ ô nhập theo.
    if (value.toLowerCase() !== raw.trim().toLowerCase())
      setRaw(isAccentPreset(value) ? "" : value);
  }, [value, raw]);
  const custom = !isAccentPreset(value);
  const issue = accentIssue(value);
  const check = isAccentHex(value) ? checkAccent(value) : null;
  const ratio = check ? check.ratio.toFixed(1) : "";
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={s("accent")} className="flex flex-wrap gap-2">
        {COMPANY_ACCENTS.map((a) => (
          // biome-ignore lint/a11y/useSemanticElements: nút chọn màu dạng radio theo mockup
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={value === a}
            onClick={() => set(a)}
            style={{ "--sw": accentSwatch(a) } as React.CSSProperties}
            className={`inline-flex h-9 items-center gap-2 rounded-full border bg-panel px-3 text-[13px] ${value === a ? "border-[var(--sw)] shadow-[0_0_0_1px_var(--sw)]" : "border-rule"}`}
          >
            <i className="h-5 w-5 rounded-full bg-[var(--sw)]" />
            {t(`contracts.gape.accent.${a}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="co-accent-hex" className="text-label font-medium">
          {s("accentCustom")}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label={s("accentCustom")}
            className="h-9 w-12 cursor-pointer rounded-md border border-rule bg-panel p-1"
            value={isAccentHex(value) ? value : accentSwatch(value)}
            onChange={(e) => set(e.target.value.toLowerCase())}
          />
          <input
            id="co-accent-hex"
            data-testid="accent-hex"
            className={`${FIELD} max-w-40 font-mono`}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            placeholder="#1D4ED8"
            value={raw}
            aria-invalid={custom && issue !== null}
            aria-describedby="co-accent-msg"
            onChange={(e) => {
              setRaw(e.target.value);
              const n = normalizeHex(e.target.value);
              if (n) set(n);
            }}
          />
        </div>
        <p
          id="co-accent-msg"
          role={issue ? "alert" : undefined}
          className={`text-caption ${issue ? "text-late" : "text-dim"}`}
          data-testid="accent-msg"
        >
          {custom && issue === "invalid" && s("accentHexInvalid")}
          {custom && issue === "low" && s("accentLow", { ratio })}
          {custom && !issue && s("accentOk", { ratio })}
        </p>
        {issue === "low" && check?.suggestion && (
          <div>
            <Btn size="sm" onClick={() => set(check.suggestion as string)}>
              {s("accentSuggest", { hex: check.suggestion.toUpperCase() })}
            </Btn>
          </div>
        )}
      </div>
      {issue === null ? <Preview accent={value} /> : null}
    </div>
  );
}
