// CR-189 · điện thoại/cảm ứng ⇒ sơ đồ sửa chỉ dùng menu «⋯» (không kéo thả). Theo `matchMedia`, đổi theo khi xoay/đổi cỡ.
import { useEffect, useState } from "react";

const QUERY = "(pointer: coarse), (max-width: 767px)";

export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(QUERY).matches === true,
  );
  useEffect(() => {
    const m = window.matchMedia?.(QUERY);
    if (!m) return;
    const on = () => setTouch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return touch;
}
