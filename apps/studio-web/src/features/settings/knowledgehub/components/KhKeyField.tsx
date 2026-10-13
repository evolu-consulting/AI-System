// HUB-FR-131 · D2 · G14 · ô `Khoá`: Select secret `kh_api_key` nền tảng + link "Tạo secret" (→ /secrets).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { MessageSpec } from "#/lib/api-error";
import { useKhKeys } from "../hooks/use-kh-keys";
import { KhField } from "./KhField";

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** Khoá đang gắn (Sửa) — luôn có trong danh sách dù đã bị lọc/đổi. */
  current?: { id: string; name: string };
  disabled?: boolean;
  error?: MessageSpec;
};

export function KhKeyField({ value, onChange, current, disabled, error }: Props) {
  const { t } = useTranslation();
  const { keys, loading } = useKhKeys();
  const options = current && !keys.some((k) => k.id === current.id) ? [current, ...keys] : keys;
  const empty = !loading && options.length === 0;
  return (
    <KhField id="kh-key" label={t("knowledgehub.sheet.key")} error={error}>
      {(p) => (
        <div className="space-y-1.5">
          <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger {...p} className="w-full">
              <SelectValue>{options.find((o) => o.id === value)?.name ?? null}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
              {loading ? (
                <div role="status" className="px-2 py-1.5 text-label text-muted-foreground">
                  {t("knowledgehub.sheet.keyLoading")}
                </div>
              ) : null}
            </SelectContent>
          </Select>
          {empty ? (
            <p className="text-label text-muted-foreground">{t("knowledgehub.sheet.keyNone")}</p>
          ) : null}
          <Link to="/secrets" className="text-label text-primary underline underline-offset-2">
            {t("knowledgehub.sheet.createSecret")}
          </Link>
        </div>
      )}
    </KhField>
  );
}
