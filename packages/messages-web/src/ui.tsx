// CR-169 · lát 5b · cầu nối giao diện nền: component của gói dùng các tên này, app cấp bản thật qua `host.ui` (xem host.ts).
import type { ComponentProps } from "react";
import { type MessagesUi, messagesHost } from "./host";

export const cn: MessagesUi["cn"] = (...a) => messagesHost().ui.cn(...a);
export const confirmDialog: MessagesUi["confirm"] = (o) => messagesHost().ui.confirm(o);

export const Skeleton = (p: ComponentProps<MessagesUi["Skeleton"]>) => {
  const C = messagesHost().ui.Skeleton;
  return <C {...p} />;
};
export const Dialog = (p: ComponentProps<MessagesUi["Dialog"]>) => {
  const C = messagesHost().ui.Dialog;
  return <C {...p} />;
};
export const DialogContent = (p: ComponentProps<MessagesUi["DialogContent"]>) => {
  const C = messagesHost().ui.DialogContent;
  return <C {...p} />;
};
export const DialogHeader = (p: ComponentProps<MessagesUi["DialogHeader"]>) => {
  const C = messagesHost().ui.DialogHeader;
  return <C {...p} />;
};
export const DialogTitle = (p: ComponentProps<MessagesUi["DialogTitle"]>) => {
  const C = messagesHost().ui.DialogTitle;
  return <C {...p} />;
};
export const DialogDescription = (p: ComponentProps<MessagesUi["DialogDescription"]>) => {
  const C = messagesHost().ui.DialogDescription;
  return <C {...p} />;
};
