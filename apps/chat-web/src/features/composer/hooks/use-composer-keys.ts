// CHAT-AC-05, HUB-FR-10 · phím của textarea: menu `/` mở thì ↑↓ Enter Tab Esc thuộc menu; còn lại Enter gửi / Esc dừng.
import type { KeyboardEvent } from "react";
import { keyAction, type MenuKeyAction, menuKeyAction } from "../lib/composer-logic";
import type { Suggest } from "./use-suggest";

export type ComposerKeysDeps = {
  suggest: Pick<Suggest<unknown>, "open" | "matches" | "move" | "dismiss">;
  running: boolean;
  pickCommand(): void;
  send(): void;
  stop?(): void;
};

function runMenuAction(d: ComposerKeysDeps, action: MenuKeyAction): void {
  if (action === "dismiss") d.suggest.dismiss();
  else if (action === "pick") d.pickCommand();
  else d.suggest.move(action === "next" ? 1 : -1);
}

export function composerKeyHandler(d: ComposerKeysDeps) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const key = { key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing };
    const menu = d.suggest.open ? menuKeyAction(key, d.suggest.matches.length > 0) : null;
    const action = menu ? "none" : keyAction(key, d.running);
    if (!menu && action === "none") return;
    e.preventDefault();
    if (menu) runMenuAction(d, menu);
    else if (action === "stop") d.stop?.();
    else if (!d.running) d.send();
  };
}
