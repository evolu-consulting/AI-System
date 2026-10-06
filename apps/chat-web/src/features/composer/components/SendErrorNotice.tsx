// HUB-FR-10/11 · lỗi gửi có mã riêng, hiện trong composer (`role="alert"`): câu lỗi + gợi ý "Ý bạn là" (plan-frontend §1.4).
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { SendErrorView } from "../lib/send-error";

export type SendErrorNoticeProps = {
  view: SendErrorView;
  /** Nút gợi ý: nhận tên trần (`translate` / `dify-chatbot`), nhãn nút có tiền tố `/` hoặc `@`. */
  onPick(suggestion: string): void;
};

export function SendErrorNotice({ view, onPick }: SendErrorNoticeProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="mb-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      {view.lines.map((l) => (
        <p key={l.key}>{t(l.key, l.params)}</p>
      ))}
      {view.suggestions.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-foreground">
          <span>{t("sendError.didYouMean")}</span>
          {view.suggestions.map((s) => (
            <Button
              key={s}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onPick(s)}
            >{`${view.suggestionPrefix ?? "/"}${s}`}</Button>
          ))}
        </p>
      )}
    </div>
  );
}
