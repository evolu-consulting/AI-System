// CHAT-AC-57 · plan-frontend §4: ô trả lời inline (`/runs/$id`, DM): `textbox "Câu trả lời"` + `Gửi trả lời`.
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { ANSWER_MAX } from "../lib/ask-rules";

type Props = {
  value: string;
  onChange(v: string): void;
  onSubmit(): void;
  pending: boolean;
  error: string | null;
  hint: boolean;
};

export function AskAnswerBox({ value, onChange, onSubmit, pending, error, hint }: Props) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Label htmlFor={id}>{t("process.ask.answer")}</Label>
      <Textarea
        id={id}
        value={value}
        rows={3}
        maxLength={ANSWER_MAX + 1}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-caption text-muted-foreground">{t("process.ask.hintMulti")}</p>}
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {t("process.ask.send")}
        </Button>
      </div>
    </form>
  );
}
