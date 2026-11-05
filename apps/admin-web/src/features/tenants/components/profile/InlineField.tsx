// CR-121 · ô thông tin sửa tại chỗ: bấm giá trị (hoặc nút bút) ⇒ ô nhập + Lưu/Huỷ; Enter lưu, Esc huỷ. Chỉ đọc khi không có quyền.
import { Check, Pencil, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { Input } from "@/components/ui/input";
import { useTr } from "@/lib/use-translate";

type Props = {
  id: string;
  label: string;
  /** Giá trị hiện tại (null = chưa khai). */
  value: string | null;
  /** Hiển thị tuỳ biến (vd số kèm đơn vị); mặc định = `value`. */
  display?: ReactNode;
  readOnly?: boolean;
  inputMode?: "text" | "numeric" | "email" | "tel";
  /** Nội dung ô nhập khi mở sửa: trả KHOÁ lỗi i18n, hoặc undefined khi hợp lệ; lưu thật do `onSave`. */
  validate: (raw: string) => string | undefined;
  /** Gọi API; ném lỗi ⇒ ô giữ nguyên ở chế độ sửa, hiện lỗi. */
  onSave: (raw: string) => Promise<void>;
  /** Lỗi server đã dịch (vd 400 từ API). */
  hint?: string;
};

export function InlineField({
  id,
  label,
  value,
  display,
  readOnly = false,
  inputMode = "text",
  validate,
  onSave,
  hint,
}: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(value ?? "");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const open = () => {
    if (readOnly) return;
    setRaw(value ?? "");
    setError(undefined);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError(undefined);
  };
  const save = async () => {
    const bad = validate(raw);
    if (bad) {
      setError(tr(bad));
      return;
    }
    if (raw.trim() === (value ?? "")) {
      cancel();
      return;
    }
    setPending(true);
    try {
      await onSave(raw);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toast.saveFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="grid items-start gap-1 py-2 sm:grid-cols-[11rem_1fr]"
      data-testid={`field-${id}`}
    >
      <label htmlFor={`${id}-input`} className="pt-1.5 text-label text-muted-foreground">
        {label}
      </label>
      {editing ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Input
              id={`${id}-input`}
              ref={ref}
              value={raw}
              inputMode={inputMode}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              disabled={pending}
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                } else if (e.key === "Escape") cancel();
              }}
            />
            <IconButton label={t("common.save")} disabled={pending} onClick={() => void save()}>
              <Check />
            </IconButton>
            <IconButton label={t("common.cancel")} disabled={pending} onClick={cancel}>
              <X />
            </IconButton>
          </div>
          {error ? (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          ) : hint ? (
            <p className="text-caption text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          {readOnly ? (
            <span className="py-1.5 text-body">{display ?? value ?? <Empty />}</span>
          ) : (
            <button
              type="button"
              id={`${id}-input`}
              onClick={open}
              className="rounded-lg px-2 py-1.5 text-left text-body hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {display ?? value ?? <Empty />}
            </button>
          )}
          {readOnly ? null : (
            <IconButton label={t("tenants.company.edit", { field: label })} onClick={open}>
              <Pencil />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}

function Empty() {
  const { t } = useTranslation();
  return <span className="text-muted-foreground">{t("tenants.company.empty")}</span>;
}
