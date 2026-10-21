// prefs-sync · công tắc Giao diện + Ngôn ngữ DÙNG CHUNG, đặt trong menu tài khoản của cả 4 web (cùng vị trí, cùng giao diện).
// Style nội tuyến + biến màu của app (như TopShell/AppSwitcher); nhãn song ngữ theo ngôn ngữ đang chọn.
import type { Locale, Theme } from "@ai/contracts";
import { type CSSProperties, type ReactElement, useSyncExternalStore } from "react";
import { type Prefs, prefs } from "../prefs/prefs";

const ROW: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "8px 16px" };
const LABEL: CSSProperties = { fontSize: 13, color: "var(--muted-foreground, var(--dim, #666))" };
const GROUP: CSSProperties = {
  marginLeft: "auto",
  display: "inline-flex",
  padding: 2,
  borderRadius: 8,
  border: "1px solid var(--border, var(--rule, #ddd))",
};
const btn = (on: boolean): CSSProperties => ({
  padding: "3px 10px",
  fontSize: 12.5,
  borderRadius: 6,
  border: 0,
  cursor: "pointer",
  fontWeight: on ? 600 : 400,
  background: on ? "var(--accent, var(--act-soft, #eef2ff))" : "transparent",
  color: on
    ? "var(--accent-foreground, var(--act, inherit))"
    : "var(--foreground, var(--ink, inherit))",
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

export function usePrefs(): Prefs {
  return useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);
}

function Segmented<T extends string>(p: {
  label: string;
  value: T;
  options: readonly [T, string][];
  onPick: (v: T) => void;
}): ReactElement {
  return (
    <div style={ROW}>
      <span style={LABEL}>{p.label}</span>
      <span role="radiogroup" aria-label={p.label} style={GROUP}>
        {p.options.map(([v, text]) => (
          // biome-ignore lint/a11y/useSemanticElements: nút dạng radio (nhóm phân đoạn) dùng được trong menu của mọi app
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={p.value === v}
            style={btn(p.value === v)}
            onClick={() => p.value !== v && p.onPick(v)}
          >
            {text}
          </button>
        ))}
      </span>
    </div>
  );
}

export function PrefsPanel(): ReactElement {
  const cur = usePrefs();
  const tx = TEXT[cur.locale];
  return (
    <div data-testid="prefs-panel">
      <Segmented
        label={tx.theme}
        value={cur.theme}
        options={THEMES.map((v) => [v, tx[v]] as [Theme, string])}
        onPick={(theme) => void prefs.set({ theme })}
      />
      <Segmented
        label={tx.language}
        value={cur.locale}
        options={LOCALES}
        onPick={(locale) => void prefs.set({ locale })}
      />
    </div>
  );
}
