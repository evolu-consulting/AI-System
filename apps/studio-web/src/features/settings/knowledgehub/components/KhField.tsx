// HUB-FR-131 · khung một trường của Sheet: nhãn + ô + gợi ý + câu lỗi (key i18n + tham số, vd `{reason}` của G15).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "#/components/ui/label";
import type { MessageSpec } from "#/lib/api-error";

type Props = {
  id: string;
  label: string;
  error?: MessageSpec;
  hint?: string;
  children: (a: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
};

export function KhField({ id, label, error, hint, children }: Props) {
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
          {t(error.key, error.params)}
        </p>
      ) : null}
    </div>
  );
}
