// HUB-FR-68 · khung một trường của Sheet: nhãn + ô + gợi ý + câu lỗi (key i18n); truyền `id`/aria cho ô qua render-prop.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "#/components/ui/label";

type Props = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: (a: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
};

export function FieldFrame({ id, label, error, hint, children }: Props) {
  const { t } = useTranslation();
  const desc = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        ...(error ? { "aria-invalid": true as const } : {}),
        ...(desc ? { "aria-describedby": desc } : {}),
      })}
      {hint ? (
        <p id={`${id}-hint`} className="text-label text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} className="text-label text-danger">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
