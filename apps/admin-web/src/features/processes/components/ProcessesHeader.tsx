// ADM-FR-65 · CR-105 UX: đầu trang danh sách quy trình — mô tả theo tab, chọn tenant (không ở tab Thư viện), nút tạo.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { TenantPicker } from "@/components/shared/TenantPicker";
import { Button } from "@/components/ui/button";
import type { ProcessesView } from "../hooks/use-processes-view";

/** Mô tả trang theo tab: Thư viện (platform) / Mẫu · chạy thử / mặc định cũ. */
const subtitleKey = (v: ProcessesView): string =>
  v.library
    ? "process.admin.library.subtitle"
    : v.templates
      ? "process.admin.library.samplesSubtitle"
      : "process.admin.list.subtitle";

function CreateButton({ v }: { v: ProcessesView }) {
  const { t } = useTranslation();
  if (v.library)
    return (
      <Button
        disabled={v.defaultSrc === null}
        onClick={() => v.defaultSrc && v.cloneFlow.open(v.defaultSrc)}
      >
        {t("process.admin.library.createFromDefault")}
      </Button>
    );
  if (!v.canWrite) return null;
  return (
    <Button asChild>
      <Link to="/processes/new">{t("process.admin.list.create")}</Link>
    </Button>
  );
}

export function ProcessesHeader({ v }: { v: ProcessesView }) {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={t("process.admin.list.title")}
      description={t(subtitleKey(v))}
      actions={
        <>
          {/* Quy trình thư viện áp cho toàn nền tảng ⇒ không chọn tenant ở tab Thư viện */}
          {v.tenant.isPlatform && !v.library ? (
            <TenantPicker
              tenants={v.tenant.tenants ?? []}
              value={v.tenant.tenantKey}
              onChange={v.tenant.setTenant}
            />
          ) : null}
          <CreateButton v={v} />
        </>
      }
    />
  );
}
