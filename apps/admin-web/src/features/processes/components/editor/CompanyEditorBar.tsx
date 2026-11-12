// CR-127 · M2 (mock Editor.dc) · thanh trên của màn soạn quy trình CÔNG TY: ← Quy trình · tên (sửa tại chỗ) · công ty · Nháp/Đang áp dụng · đã lưu HH:MM · Lượt chạy.
// «Chạy thử» + «Áp dụng cho công ty» nằm ở thanh dưới (ProcessSaveBar) vì cùng một biểu mẫu.
import { Link, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTenantDetail } from "@/features/tenants/api";
import { useCompanyFlowList } from "@/features/tenants/flows/company-flows-api";
import { DeleteDraftFlow } from "../DeleteDraftFlow";

type Props = {
  name: string;
  onName: (v: string) => void;
  readOnly: boolean;
  tenantId: string;
  flowId: string;
  dirty: boolean;
  /** Mốc lưu gần nhất (ms) — vắng ⇒ không hiện. */
  savedAt: number | undefined;
  runsOn: boolean;
  onRuns: () => void;
};

function savedText(t: TFunction, dirty: boolean, savedAt: number | undefined): string {
  if (dirty) return t("common.unsaved");
  if (!savedAt) return "";
  const time = new Date(savedAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return t("process.admin.editorBar.saved", { time });
}

export function CompanyEditorBar(p: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const company = useTenantDetail(p.tenantId, true).data?.name ?? "";
  const row = useCompanyFlowList(p.tenantId).data?.items.find((x) => x.flow_id === p.flowId);
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-3 border-b border-border pb-3"
      data-testid="company-editor-bar"
    >
      <Button variant="ghost" size="sm" asChild>
        <Link to="/processes">
          <ArrowLeft aria-hidden className="size-4" />
          {t("process.admin.editorBar.back")}
        </Link>
      </Button>
      <Input
        aria-label={t("process.admin.editorBar.name")}
        className="w-72 font-medium"
        value={p.name}
        maxLength={120}
        readOnly={p.readOnly}
        onChange={(e) => p.onName(e.target.value)}
      />
      {company ? <span className="text-body text-muted-foreground">{company}</span> : null}
      {row ? (
        <Badge variant={row.enabled ? "ok" : "outline"}>
          {t(row.enabled ? "process.admin.byCompany.on" : "process.admin.byCompany.draft")}
        </Badge>
      ) : null}
      <span className="text-caption text-muted-foreground" role="status">
        {savedText(t, p.dirty, p.savedAt)}
      </span>
      {row && !p.readOnly ? (
        <span className="ml-auto">
          <DeleteDraftFlow
            tenantId={p.tenantId}
            flow={row}
            onDeleted={() => void navigate({ to: "/processes" })}
          />
        </span>
      ) : null}
      <Button
        variant="link"
        size="sm"
        className={row?.deletable && !p.readOnly ? "" : "ml-auto"}
        aria-pressed={p.runsOn}
        onClick={p.onRuns}
        data-testid="editor-runs-link"
      >
        {t(p.runsOn ? "process.admin.editorBar.config" : "process.admin.editorBar.runs")}
      </Button>
    </div>
  );
}
