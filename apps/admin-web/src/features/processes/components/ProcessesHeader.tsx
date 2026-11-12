// ADM-FR-65 · CR-105 UX: đầu trang danh sách quy trình — mô tả theo tab, chọn tenant (không ở tab Thư viện), nút tạo.
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { CreateFlowDialog } from "@/features/tenants/flows/components/CreateFlowDialog";
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
  const [open, setOpen] = useState(false);
  // CR-127 · M1: «Tạo quy trình» = chọn CÔNG TY trước → tên → trống / từ mẫu Thư viện (không mở thẳng hộp «Dùng mẫu …»)
  if (v.library)
    return (
      <>
        <Button onClick={() => setOpen(true)} data-testid="create-flow-open">
          {t("process.admin.library.createFromDefault")}
        </Button>
        <CreateFlowDialog open={open} onOpenChange={setOpen} />
      </>
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
      title={t(v.library ? "process.admin.byCompany.title" : "process.admin.list.title")}
      description={t(v.library ? "process.admin.byCompany.subtitle" : subtitleKey(v))}
      actions={<CreateButton v={v} />}
    />
  );
}
