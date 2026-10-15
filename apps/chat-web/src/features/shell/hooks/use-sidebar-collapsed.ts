// Polish UI · trạng thái thu gọn sidebar desktop, nhớ trong localStorage (lỗi/thiếu → mở rộng).
import { useCallback, useState } from "react";
import { readLocal, writeLocal } from "~/lib/storage";

const KEY = "chat:sidebar:collapsed";

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => readLocal(KEY) === "1");
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      writeLocal(KEY, c ? "0" : "1");
      return !c;
    });
  }, []);
  return { collapsed, toggle };
}
