// CHAT-AC-53 · P-c1 · nhóm nút của thẻ "Cần người quyết". Tự sửa mã (mockup Pc-Decision): "Huỷ" (viền) trước, "Thêm lượt" (nền chính) sau, căn phải.
import type { DecisionOption } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { CancelAction } from "./CancelAction";

type Props = {
  options: DecisionOption[];
  autofix: boolean;
  over: boolean;
  pending: boolean;
  useCurrentDisabled: boolean;
  onRun: (o: DecisionOption) => void;
};

export function DecisionButtons({
  options,
  autofix,
  over,
  pending,
  useCurrentDisabled,
  onRun,
}: Props) {
  const { t } = useTranslation();
  const add = options.includes("add_attempt") && (
    <Button type="button" size="sm" disabled={over || pending} onClick={() => onRun("add_attempt")}>
      {t("process.common.option.add_attempt")}
    </Button>
  );
  const use = options.includes("use_current") && (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={useCurrentDisabled || over}
      onClick={() => onRun("use_current")}
    >
      {t("process.common.option.use_current")}
    </Button>
  );
  const cancel = options.includes("cancel") && (
    <CancelAction outline={autofix} disabled={pending} onConfirm={() => onRun("cancel")} />
  );
  return (
    <div className={`flex flex-wrap gap-2 ${autofix ? "justify-end" : ""}`}>
      {autofix ? (
        <>
          {cancel}
          {add}
        </>
      ) : (
        <>
          {add}
          {use}
          {cancel}
        </>
      )}
    </div>
  );
}
