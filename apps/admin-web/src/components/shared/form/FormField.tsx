// ADM-FR-60 · FormField mỏng (thay `form` của shadcn): nhãn + control + mô tả + lỗi, aria-describedby/aria-invalid.
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

type Props = {
  id: string;
  label: string;
  description?: string;
  /** Câu lỗi đã dịch (không phải key). */
  error?: string;
  /** Lỗi đẩy từ Hub sau khi lưu: thông báo ngay cho trình đọc màn hình (`role=alert`). */
  alert?: boolean;
  children: (props: FieldControlProps) => ReactNode;
};

export function FormField({ id, label, description, error, alert, children }: Props) {
  const descId = description ? `${id}-desc` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, descId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {description ? (
        <p id={descId} className="text-caption text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p
          id={errId}
          role={alert ? "alert" : undefined}
          className="flex items-center gap-1 text-caption text-destructive"
        >
          <CircleAlert aria-hidden className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
