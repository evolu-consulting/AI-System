// CR-118 · cr118-app-config · tab "Xem trước" (F3 "X đang thấy gì?"): chọn công ty + vai (+ bản nháp chưa lưu của công ty đang sửa ở tab Công ty).
import type { AppManifest, PreviewRole } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/states/EmptyState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CompanyRow, PreviewVersion } from "../../lib/app-config";
import { AppPreview } from "../AppPreview";

type Props = {
  manifest: AppManifest | undefined;
  rows: CompanyRow[];
  tenantId: string | undefined;
  onTenant: (id: string) => void;
  draft: ReadonlySet<string> | null;
  role: PreviewRole;
  onRole: (r: PreviewRole) => void;
  version: PreviewVersion;
  onVersion: (v: PreviewVersion) => void;
};

export function PreviewTab({ manifest, rows, tenantId, onTenant, draft, ...rest }: Props) {
  const { t } = useTranslation();
  if (!manifest) return <EmptyState message={t("appcfg.preview.noManifest")} />;
  const picker = (
    <Select value={tenantId ?? ""} onValueChange={onTenant}>
      <SelectTrigger className="w-64" aria-label={t("appcfg.preview.companyAria")}>
        <SelectValue placeholder={t("appcfg.preview.companyPlaceholder")} />
      </SelectTrigger>
      <SelectContent>
        {rows.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <AppPreview manifest={manifest} tenantId={tenantId} draft={draft} picker={picker} {...rest} />
  );
}
