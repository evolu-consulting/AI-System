// HUB-FR-68 · PC2-R10 · FC2/FC4 · ô "Khoá nguồn" trong form nguồn git: chọn khoá của tenant / "Không — repo công khai" /
// "+ Tạo khoá mới…" (mở dialog, lưu xong tự chọn). Chỉ gửi id khoá; token không bao giờ ở đây.
import type { HubSecret } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCredentials } from "../api";
import { CredentialDialog } from "./CredentialDialog";

const NONE = "__none__";
const NEW = "__new__";

type Props = {
  id: string;
  tenantId: string | undefined;
  /** "" = không khoá (repo công khai); uuid = khoá đã chọn. */
  value: string;
  onChange: (id: string) => void;
  error?: string;
};

export function CredentialField({ id, tenantId, value, onChange, error }: Props) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState(false);
  const [justCreated, setJustCreated] = useState<HubSecret | null>(null);
  const list = useCredentials(tenantId, true);

  const creds = list.data?.items ?? [];
  const merged =
    justCreated && !creds.some((c) => c.id === justCreated.id) ? [justCreated, ...creds] : creds;
  const selected = merged.find((c) => c.id === value);
  const known = !!selected;
  const selectValue = value === "" ? NONE : value;
  // Radix bỏ mount SelectContent khi đóng ⇒ tự dựng nhãn hiển thị (không phụ thuộc item đã mount).
  const selectedLabel =
    value === ""
      ? t("process.sources.credential.none")
      : (selected?.name ?? t("process.sources.credential.gone"));

  const onValueChange = (v: string) => {
    if (v === NEW) return setDialog(true);
    onChange(v === NONE ? "" : v);
  };

  return (
    <FormField
      id={id}
      label={t("process.sources.credential.label")}
      description={t("process.sources.credential.hint")}
      error={error}
      alert
    >
      {(p) => (
        <>
          <Select value={selectValue} onValueChange={onValueChange}>
            <SelectTrigger
              {...p}
              aria-label={t("process.sources.credential.label")}
              className="w-full"
            >
              <SelectValue>{selectedLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {merged.map((c) => (
                <SelectItem key={c.id} value={c.id} className="font-mono">
                  {c.name}
                </SelectItem>
              ))}
              {value !== "" && !known ? (
                <SelectItem value={value}>{t("process.sources.credential.gone")}</SelectItem>
              ) : null}
              <SelectItem value={NONE}>{t("process.sources.credential.none")}</SelectItem>
              <SelectItem value={NEW}>{t("process.sources.credential.new")}</SelectItem>
            </SelectContent>
          </Select>
          {dialog ? (
            <CredentialDialog
              idPrefix={`${id}-create`}
              tenantId={tenantId}
              onClose={() => setDialog(false)}
              onCreated={(cred) => {
                setJustCreated(cred);
                onChange(cred.id);
              }}
            />
          ) : null}
        </>
      )}
    </FormField>
  );
}
