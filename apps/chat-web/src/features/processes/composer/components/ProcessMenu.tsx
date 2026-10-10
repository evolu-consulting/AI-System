// CR-056 · P-a Bước 0: STUB PF1 — listbox "Quy trình" (menu `!`, `SuggestMenu` + `aria-activedescendant`).
import type { BangSuggest } from "../hooks/use-bang-suggest";

export type ProcessMenuProps = { suggest: BangSuggest; onPick(index: number): void };

export function ProcessMenu(_props: ProcessMenuProps) {
  return null;
}
