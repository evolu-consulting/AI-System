// HUB-FR-68 · Q7 · D6 · ô `Phạm vi` của khoá KnowledgeHub: "Toàn nền tảng" (mặc định) hoặc một tenant (option = `tenant.name`).
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { useScopeTenants } from "../hooks/use-scope-options";
import { PLATFORM } from "../lib/schema";
import { FieldFrame } from "./FieldFrame";

type Props = { value: string; onChange: (v: string) => void; disabled?: boolean; error?: string };

export function ScopeField({ value, onChange, disabled, error }: Props) {
  const { t } = useTranslation();
  const { tenants, loading, error: loadError } = useScopeTenants();
  const options = [
    { id: PLATFORM, label: t("secrets.scope.platform") },
    ...tenants.map((x) => ({ id: x.id, label: x.name })),
  ];
  const status = loading
    ? t("secrets.scope.loading")
    : loadError
      ? t("secrets.scope.loadError")
      : null;
  return (
    <FieldFrame
      id="secret-scope"
      label={t("secrets.field.scope")}
      error={error}
      hint={status ?? undefined}
    >
      {(p) => (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger {...p} className="w-full">
            <SelectValue>{options.find((o) => o.id === value)?.label ?? null}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FieldFrame>
  );
}
