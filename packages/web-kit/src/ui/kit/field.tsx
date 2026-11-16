// CR-177 · Field: nhãn + mô tả + lỗi, gắn aria-describedby/aria-invalid vào control con.
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";

export function Field({
  id,
  label,
  description,
  error,
  required,
  className,
  children,
}: {
  /** id của control; nhãn, mô tả, lỗi suy ra từ đây. */
  id: string;
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  const descId = description ? `${id}-desc` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(" ") || undefined;
  const child = Children.only(children);
  return (
    <div data-slot="field" className={cn("flex flex-col gap-1.5", className)}>
      <label data-slot="label" htmlFor={id} className="text-sm font-semibold text-foreground">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {isValidElement(child) &&
        cloneElement(child, {
          id,
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined,
        })}
      {description && (
        <p data-slot="field-description" id={descId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p data-slot="field-error" id={errId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
