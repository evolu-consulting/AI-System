// CHAT-AC-57 · HUB-FR-111 · plan-frontend §4: nút "Nhờ người khác trả lời"/"Chuyển người khác kiểm". Chữ ký do Bước 0 giữ:
// PF1 (thẻ kiểm) gọi, PF2 hiện thực. Đủ `FORWARD_CHAIN_MAX` lần ⇒ `aria-disabled` + tooltip "Đã nhờ tối đa 3 lần".
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { FORWARD_CHAIN_MAX } from "../lib/ask-rules";
import type { ForwardActionProps } from "../lib/forward-props";

const ForwardDialog = lazy(() =>
  import("./ForwardDialog").then((m) => ({ default: m.ForwardDialog })),
);

export type { ForwardActionProps };

export function ForwardAction(props: ForwardActionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const locked = props.forwardCount >= FORWARD_CHAIN_MAX;
  const label = t(props.kind === "ask" ? "process.ask.forward" : "process.ask.forwardReview");
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-disabled={locked || undefined}
        title={locked ? t("process.ask.locked", { max: FORWARD_CHAIN_MAX }) : undefined}
        className={locked ? "cursor-not-allowed opacity-50" : undefined}
        onClick={() => !locked && setOpen(true)}
      >
        {label}
      </Button>
      {open && (
        <Suspense fallback={null}>
          <ForwardDialog {...props} open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
