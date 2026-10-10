// CR-056 · P-a Bước 0: STUB PF1 — trạng thái menu `!` (mở/lọc/chọn) cùng dạng `useAgentSuggest`. Bước 0: luôn đóng.
import type { Suggest } from "~/features/composer/hooks/use-suggest";
import type { ProcessMatch } from "../lib/bang";

export type BangSuggest = Suggest<ProcessMatch>;

const CLOSED: BangSuggest = {
  open: false,
  q: "",
  status: "loading",
  matches: [],
  active: 0,
  retry: () => {},
  move: () => {},
  dismiss: () => {},
  pick: () => null,
};

/** `enabled=false` (cờ off / menu tắt) ⇒ không gọi `GET /processes`. */
export function useBangSuggest(_text: string, _caret: number, _enabled: boolean): BangSuggest {
  return CLOSED;
}
