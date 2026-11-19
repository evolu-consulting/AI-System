// CR-188 · BR-188-6 · trạng thái hộp «Kiểm tra tệp» cho danh sách HĐ: `open()` = dò toàn công ty; `open(hđ)` = mở từ «⋯» của HĐ đó.
import { useCallback, useState } from "react";
import { VerifyFileDialog } from "./VerifyFileDialog";
import type { VerifyFrom } from "./VerifyFilePanel";

export function useVerifyDialog() {
  const [st, setSt] = useState<{ from?: VerifyFrom } | null>(null);
  const open = useCallback((from?: VerifyFrom) => setSt(from ? { from } : {}), []);
  return {
    open,
    node: <VerifyFileDialog open={st !== null} from={st?.from} onClose={() => setSt(null)} />,
  };
}
