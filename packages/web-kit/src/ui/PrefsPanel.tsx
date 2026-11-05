// prefs-sync · công tắc Giao diện + Ngôn ngữ DÙNG CHUNG, đặt trong menu tài khoản của cả 4 web (cùng vị trí, cùng giao diện).
// CR-120 · tối giản: MỘT hàng — Giao diện = nhóm 3 nút CHỈ biểu tượng (Mặt trời / Mặt trăng / Theo máy, có tooltip + aria-label, không chữ),
// Ngôn ngữ = nhóm VI | EN gọn cùng kiểu. Không viền/ô hộp; nền chip theo token của app (shell/admin/chat/studio), tối dùng được.
// Vai trò a11y giữ nguyên (radiogroup "Giao diện"/"Ngôn ngữ" + radio "Sáng"/"Tối"/"Theo máy", "VI"/"EN").
import type { Locale, Theme } from "@ai/contracts";
import { type CSSProperties, type ReactElement, useSyncExternalStore } from "react";
import { type Prefs, prefs } from "../prefs/prefs";

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "6px 12px",
};
const GROUP: CSSProperties = {
  display: "inline-flex",
  gap: 2,
  padding: 2,
  borderRadius: 8,
  background: "var(--muted, var(--sunk, #f3f3f7))",
};
const btn = (on: boolean): CSSProperties => ({
  display: "inline-grid",
  placeItems: "center",
  minWidth: 28,
  height: 26,
  padding: "0 8px",
  fontSize: 12,
  borderRadius: 6,
  border: 0,
  cursor: "pointer",
  fontWeight: on ? 600 : 500,
  background: on ? "var(--card, var(--panel, #fff))" : "transparent",
  boxShadow: on ? "0 1px 2px rgba(15, 16, 32, 0.12)" : "none",
  color: on
    ? "var(--accent-foreground, var(--act, inherit))"
    : "var(--muted-foreground, var(--dim, #666))",
});

const TEXT = {
  vi: { theme: "Giao diện", light: "Sáng", dark: "Tối", system: "Theo máy", language: "Ngôn ngữ" },
  en: { theme: "Theme", light: "Light", dark: "Dark", system: "System", language: "Language" },
} as const;
const THEMES: readonly Theme[] = ["light", "dark", "system"];
const LOCALES: readonly [Locale, string][] = [
  ["vi", "VI"],
  ["en", "EN"],
];

const SVG = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;
/** Đường nét lucide Sun / Moon / Monitor (nhúng để web-kit không phụ thuộc thư viện biểu tượng của app). */
const ICONS: Record<Theme, ReactElement> = {
  light: (
    <svg aria-hidden="true" {...SVG}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2m-7.07-15.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  ),
  dark: (
    <svg aria-hidden="true" {...SVG}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  ),
  system: (
    <svg aria-hidden="true" {...SVG}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
};

export function usePrefs(): Prefs {
  return useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);
}

function Segmented<T extends string>(p: {
  label: string;
  value: T;
  options: readonly { value: T; text: string; icon?: ReactElement }[];
  onPick: (v: T) => void;
}): ReactElement {
  return (
    <span role="radiogroup" aria-label={p.label} style={GROUP}>
      {p.options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: nút dạng radio (nhóm phân đoạn) dùng được trong menu của mọi app
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={p.value === o.value}
          aria-label={o.icon ? o.text : undefined}
          title={o.icon ? o.text : undefined}
          style={btn(p.value === o.value)}
          onClick={() => p.value !== o.value && p.onPick(o.value)}
        >
          {o.icon ?? o.text}
        </button>
      ))}
    </span>
  );
}

export function PrefsPanel(): ReactElement {
  const cur = usePrefs();
  const tx = TEXT[cur.locale];
  return (
    <div data-testid="prefs-panel" style={ROW}>
      <Segmented
        label={tx.theme}
        value={cur.theme}
        options={THEMES.map((v) => ({ value: v, text: tx[v], icon: ICONS[v] }))}
        onPick={(theme) => void prefs.set({ theme })}
      />
      <Segmented
        label={tx.language}
        value={cur.locale}
        options={LOCALES.map(([value, text]) => ({ value, text }))}
        onPick={(locale) => void prefs.set({ locale })}
      />
    </div>
  );
}
