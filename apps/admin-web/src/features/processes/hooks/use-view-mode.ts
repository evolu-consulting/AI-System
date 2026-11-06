// CR-121 c11 · Q11 · chế độ xem quy trình (canvas mặc định / danh sách), nhớ theo trình duyệt. Dùng lại ở Thư viện, Trình sửa (c15/c17).
import { useState } from "react";
import { readViewMode, type ViewMode, writeViewMode } from "../lib/view-mode";

export function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => readViewMode());
  return [
    mode,
    (m) => {
      writeViewMode(m);
      setMode(m);
    },
  ];
}
