// HUB-FR-94 · đếm ngược giây (429 `Retry-After`): `left` giảm mỗi giây tới 0; `start(n)` đặt lại.
import { useCallback, useEffect, useState } from "react";

export function useCountdown(): { left: number; start(seconds: number): void } {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => Math.max(n - 1, 0)), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const start = useCallback((seconds: number) => setLeft(Math.max(Math.ceil(seconds), 0)), []);
  return { left, start };
}
