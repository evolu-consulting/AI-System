// CR-122 · E3 · node Chờ sự kiện nhiều kết quả (Ký số: đã ký / từ chối / huỷ / hết hạn): luật thuần — khoá chờ, sự kiện thắng khi
// nhiều sự kiện cùng đã ghi (nhận SỚM nhất), luật rẽ bước suy từ executor (field output `event`). Lớp 1.
import type { BranchRule } from "../branch/branch-def.rules";

export type WaitEventExec = {
  kind: string;
  event?: string;
  also_events?: readonly string[];
  branches?: readonly { on: string; goto_step: number }[];
};
export const TIMEOUT_KEY = "timeout";
/** Field output của stage chờ: khoá sự kiện đã nhận hoặc `timeout`. */
export const WAIT_EVENT_FIELD = "event";

export function waitKeysOf(e: WaitEventExec | undefined): string[] {
  if (e?.kind !== "wait_event" || typeof e.event !== "string") return [];
  return [...new Set([e.event, ...(e.also_events ?? [])])];
}

/** Sự kiện thắng trong các sự kiện đã ghi chưa dùng: nhận sớm nhất (cùng lúc ⇒ theo thứ tự khai). Không có ⇒ `timeout`. */
export function winningEvent(
  keys: readonly string[],
  recorded: readonly { event: string; receivedAt: Date }[],
): string {
  const hits = recorded.filter((r) => keys.includes(r.event));
  if (hits.length === 0) return TIMEOUT_KEY;
  hits.sort(
    (a, b) =>
      a.receivedAt.getTime() - b.receivedAt.getTime() ||
      keys.indexOf(a.event) - keys.indexOf(b.event),
  );
  return hits[0]?.event ?? TIMEOUT_KEY;
}

/** Luật rẽ (cùng đường `after.branch`): `event == on` ⇒ `goto_step`. */
export const waitBranchRules = (e: WaitEventExec | undefined): BranchRule[] =>
  e?.kind === "wait_event" && Array.isArray(e.branches)
    ? e.branches.map((b) => ({
        field: WAIT_EVENT_FIELD,
        op: "eq" as const,
        value: b.on,
        gotoStep: b.goto_step,
      }))
    : [];
