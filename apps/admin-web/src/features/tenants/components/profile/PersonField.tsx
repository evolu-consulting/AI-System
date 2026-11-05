// CR-121 · CEO / Giám đốc: chọn từ thành viên nội bộ đang hoạt động của công ty (sửa tại chỗ: bấm tên ⇒ chọn + Lưu/Huỷ).
import type { TenantPerson, User } from "@ai/contracts";
import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";

type Props = {
  id: string;
  label: string;
  person: TenantPerson | null;
  /** Danh sách thành viên để chọn (chỉ nạp khi có quyền sửa). */
  members: readonly Pick<User, "id" | "display_name">[] | undefined;
  readOnly?: boolean;
  onSave: (userId: string | null) => Promise<void>;
};

export function PersonField({ id, label, person, members, readOnly = false, onSave }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState(person?.id ?? "");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const save = async () => {
    if (sel === (person?.id ?? "")) {
      setEditing(false);
      return;
    }
    setPending(true);
    try {
      await onSave(sel === "" ? null : sel);
      setEditing(false);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toast.saveFailed"));
    } finally {
      setPending(false);
    }
  };
  const open = () => {
    setSel(person?.id ?? "");
    setError(undefined);
    setEditing(true);
  };
  const shown = person ? (
    person.display_name
  ) : (
    <span className="text-muted-foreground">{t("tenants.company.empty")}</span>
  );

  return (
    <div
      className="grid items-start gap-1 py-2 sm:grid-cols-[11rem_1fr]"
      data-testid={`field-${id}`}
    >
      <label htmlFor={`${id}-select`} className="pt-1.5 text-label text-muted-foreground">
        {label}
      </label>
      {editing ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <select
              id={`${id}-select`}
              value={sel}
              disabled={pending || !members}
              onChange={(e) => setSel(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-2 text-body focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <option value="">{t("tenants.company.noneChosen")}</option>
              {(members ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
            <IconButton label={t("common.save")} disabled={pending} onClick={() => void save()}>
              <Check />
            </IconButton>
            <IconButton
              label={t("common.cancel")}
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              <X />
            </IconButton>
          </div>
          {error ? (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          ) : (
            <p className="text-caption text-muted-foreground">{t("tenants.company.leaderHint")}</p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          {readOnly ? (
            <span className="py-1.5 text-body">{shown}</span>
          ) : (
            <button
              type="button"
              id={`${id}-select`}
              onClick={open}
              className="rounded-lg px-2 py-1.5 text-left text-body hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {shown}
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
