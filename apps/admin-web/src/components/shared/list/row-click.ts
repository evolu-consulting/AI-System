// CR-121 C-1b · hàng bấm được toàn dòng: bỏ qua click vào control con (link, nút, công tắc, menu); Enter/Space khi hàng có focus.
import type { KeyboardEvent, MouseEvent } from "react";

const INTERACTIVE =
  'a,button,input,select,textarea,label,[role="switch"],[role="menuitem"],[role="combobox"],[role="checkbox"],[data-row-ignore]';

export function rowClickProps(onOpen: () => void, active = false) {
  return {
    tabIndex: 0,
    "data-active": active || undefined,
    className:
      "cursor-pointer data-[active=true]:bg-muted focus-visible:bg-muted focus-visible:outline-none",
    onClick: (e: MouseEvent<HTMLElement>) => {
      if ((e.target as Element).closest(INTERACTIVE)) return;
      onOpen();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen();
      }
    },
  };
}
