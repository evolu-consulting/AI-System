// W1 · thao tác của một việc ở "Việc của tôi" (T-DEP-5: component chỉ trình bày, gọi API qua hook): trả sổ / hẹn lại / hẹn nhắc /
// xong / ghi kết quả xử lý HĐ; xong ⇒ tải lại danh sách và gọi `onDone`.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { postHandled } from "~/features/contract-deadline/api";
import type { Outcome } from "~/features/contract-deadline/lib/deadline";
import {
  createFollowup,
  doneFollowup,
  postponeObligation,
  settleObligation,
  snoozeFollowup,
  workKeys,
} from "../api";

export function useWorkActions(id: string, onDone: () => void) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: () => {
      onDone();
      return qc.invalidateQueries({ queryKey: workKeys.all });
    },
  });
  const go = (f: () => Promise<unknown>) => run.mutate(f);
  return {
    run,
    settle: () => go(() => settleObligation(id)),
    postpone: (to: string) => go(() => postponeObligation(id, to)),
    remind: (kind: "obligation" | "contract", at: string) => go(() => createFollowup(kind, id, at)),
    snooze: (at: string) => go(() => snoozeFollowup(id, at)),
    done: () => go(() => doneFollowup(id)),
    handled: (o: Outcome) => go(() => postHandled(id, o)),
  };
}
