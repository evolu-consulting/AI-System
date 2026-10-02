// ADM-FR-62 · M3-R03 · D12 · xem trước khi dán: `dry_run` (debounce 400 ms) chỉ để hiện "Không tìm thấy: …" và "n người đã ở trong
// group"; không ghi, không đổi số trên nút. Kết quả cũ (danh sách đã đổi) bị bỏ.
import type { GroupMembersAddResponse } from "@ai/contracts";
import { useEffect, useRef, useState } from "react";
import { useAddMembers } from "../api";

const DEBOUNCE_MS = 400;
type Preview = { key: string; res: GroupMembersAddResponse };

export function usePastePreview(groupId: string, names: string[], enabled: boolean) {
  const dry = useAddMembers(groupId);
  const [state, setState] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);
  const key = names.join("\n");

  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy lại khi nội dung danh sách đổi
  useEffect(() => {
    const id = ++seq.current;
    if (!enabled || names.length === 0) {
      setState(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    const timer = setTimeout(() => {
      dry
        .mutateAsync({ usernames: names, dry_run: true })
        .then((res) => seq.current === id && setState({ key, res }))
        .catch(() => seq.current === id && setState(null))
        .finally(() => seq.current === id && setChecking(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, enabled]);

  return { preview: state?.key === key ? state.res : null, checking };
}
