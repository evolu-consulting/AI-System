// PK-FR-10 · TF5 · giá trị nhớ theo trình duyệt (`assistant:open`, `assistant:width`); storage bị chặn thì dùng mặc định.
import { useCallback, useState } from "react";

export const ASSISTANT_OPEN_KEY = "assistant:open";
export const ASSISTANT_WIDTH_KEY = "assistant:width";
/** nav-v2: thanh trái ghim mở (224 px, mặc định) hay thu thành cột biểu tượng (64 px). */
export const NAV_PINNED_KEY = "nav:pinned";
export const ASSISTANT_MIN = 280;
export const ASSISTANT_MAX = 560;
export const ASSISTANT_DEFAULT = 340;

export const clampWidth = (n: number): number =>
  Math.min(ASSISTANT_MAX, Math.max(ASSISTANT_MIN, Number.isFinite(n) ? n : ASSISTANT_DEFAULT));

export function readBool(key: string, initial: boolean): boolean {
  try {
    const s = localStorage.getItem(key);
    return s == null ? initial : s === "1";
  } catch {
    return initial;
  }
}

export function readWidth(key: string): number {
  try {
    const n = Number(localStorage.getItem(key));
    return n > 0 ? clampWidth(n) : ASSISTANT_DEFAULT;
  } catch {
    return ASSISTANT_DEFAULT;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // không lưu được: giữ trong bộ nhớ
  }
}

export function useStoredBool(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => readBool(key, initial));
  const set = useCallback(
    (x: boolean) => {
      setV(x);
      write(key, x ? "1" : "0");
    },
    [key],
  );
  return [v, set];
}

export function useStoredWidth(key: string): [number, (n: number) => void] {
  const [v, setV] = useState(() => readWidth(key));
  const set = useCallback(
    (n: number) => {
      const w = clampWidth(n);
      setV(w);
      write(key, String(w));
    },
    [key],
  );
  return [v, set];
}
