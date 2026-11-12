// CR-135 Q12: đổi tên HĐ nháp tại chỗ — bấm tên ⇒ ô sửa; Enter / rời ô ⇒ lưu; Esc ⇒ huỷ. Rỗng ⇒ báo lỗi, giữ tên cũ. Chỉ trình bày: lưu do `onSave`.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TruncText } from "~/components/shared/TruncText";

export function TitleEdit({
  value,
  editable,
  onSave,
}: {
  value: string;
  editable: boolean;
  /** Trả lỗi (chuỗi) khi không lưu được; `null` = xong. */
  onSave: (next: string) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  const busy = useRef(false);
  const esc = useRef(false);
  if (!editable) return <span>{value}</span>;
  const stop = () => {
    setEditing(false);
    setErr(null);
  };
  const commit = async () => {
    if (busy.current || esc.current) return;
    const next = text.trim();
    if (next === value) return stop();
    if (next === "") {
      setErr(t("contracts.review.titleEmpty"));
      return;
    }
    busy.current = true;
    const e = await onSave(next);
    busy.current = false;
    if (e) setErr(e);
    else stop();
  };
  if (!editing)
    return (
      <button
        type="button"
        data-testid="title-edit"
        title={t("contracts.review.titleEdit")}
        aria-label={`${t("contracts.review.titleEdit")}: ${value}`}
        className="min-w-0 max-w-full cursor-text rounded-md px-1 text-left hover:bg-sunk"
        onClick={() => {
          esc.current = false;
          setText(value);
          setEditing(true);
        }}
      >
        <TruncText>{value}</TruncText>
      </button>
    );
  return (
    <span className="flex min-w-0 flex-col">
      <input
        // biome-ignore lint/a11y/noAutofocus: người dùng vừa bấm vào tên để sửa
        autoFocus
        data-testid="title-input"
        aria-label={t("contracts.review.titleEdit")}
        aria-invalid={err !== null}
        value={text}
        maxLength={200}
        className="w-full min-w-[16rem] rounded-md border border-act bg-panel px-2 py-0.5 text-[26px] font-semibold max-sm:text-[22px]"
        onChange={(e) => {
          setText(e.target.value);
          setErr(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            esc.current = true;
            stop();
          }
        }}
      />
      {err && (
        <span role="alert" data-testid="title-error" className="text-sm font-normal text-late">
          {err}
        </span>
      )}
    </span>
  );
}
