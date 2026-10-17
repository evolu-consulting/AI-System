import { useEffect, useState } from "react";

/** Light unless a person chose otherwise: "dark", or "auto" to follow the device. Kept in this browser; index.html
 *  applies it before the first paint so a dark page never flashes white. */
export type Theme = "auto" | "light" | "dark";
const KEY = "theme";

export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "auto" ? v : "light";
  } catch { return "light"; }
}

function apply(t: Theme) {
  if (t === "auto") delete document.documentElement.dataset.theme;       // index.css follows prefers-color-scheme
  else document.documentElement.dataset.theme = t;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(storedTheme);
  useEffect(() => { apply(t); }, [t]);
  return [t, (x) => {
    setT(x);
    try { if (x === "light") localStorage.removeItem(KEY); else localStorage.setItem(KEY, x); } catch { /* not kept */ }
  }];
}
