// CR-056 · P-a Bước 0: STUB PF2 — hộp chọn người nhận (PersonPicker chọn 1) + lời nhắn.
import type { ForwardActionProps } from "./ForwardAction";

export type ForwardDialogProps = ForwardActionProps & {
  open: boolean;
  onOpenChange(open: boolean): void;
};

export function ForwardDialog(_props: ForwardDialogProps) {
  return null;
}
