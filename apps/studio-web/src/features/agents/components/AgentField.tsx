// HUB-FR-60 · H4a-R03 · khung một trường form: nhãn + gợi ý + câu lỗi (`aria-invalid` + `aria-describedby` tới câu §4).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "#/components/ui/label";
import type { AgentDraft, FieldErrors } from "../lib/draft";

/** Props chung của mọi phần (bước) của editor. */
export type SectionProps = {
  draft: AgentDraft;
  set: <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) => void;
  errors: FieldErrors;
  mode: "new" | "edit";
};

export type ControlProps = { id: string; "aria-invalid"?: true; "aria-describedby"?: string };

type Props = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  /** `false` khi nhãn là tiêu đề nhóm (radiogroup/checkbox) chứ không gắn `htmlFor`. */
  asLabel?: boolean;
  children: (p: ControlProps) => ReactNode;
};

export function Field({ id, label, error, hint, asLabel = true, children }: Props) {
  const { t } = useTranslation();
  const ids = [hint ? `${id}-hint` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ");
  const control: ControlProps = { id };
  if (error) control["aria-invalid"] = true;
  if (ids) control["aria-describedby"] = ids;
  return (
    <div className="space-y-1.5">
      {asLabel ? (
        <Label htmlFor={id}>{label}</Label>
      ) : label ? (
        <p className="text-label font-medium">{label}</p>
      ) : null}
      {children(control)}
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
