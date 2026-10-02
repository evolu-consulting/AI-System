// ADM-FR-62 · M3-R01 · trang tạo group (một cột): Key · Tên (VI/EN) · Mô tả · Huỷ · Tạo group.
import { Link } from "@tanstack/react-router";
import { FormProvider } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useOnline } from "@/components/shared/ConnectionBanner";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Button } from "@/components/ui/button";
import { useGroupForm } from "../../hooks/use-group-form";
import { GroupFields } from "./GroupFields";

type Props = { tenantId: string | undefined; tenantKey?: string };

export function GroupForm({ tenantId, tenantKey }: Props) {
  const { t } = useTranslation();
  const online = useOnline();
  const ed = useGroupForm(tenantId);
  return (
    <FormProvider {...ed.form}>
      <form onSubmit={ed.submit} noValidate className="max-w-xl space-y-6">
        <GroupFields withKey idPrefix="group-new" />
        <div className="flex gap-3">
          <Button variant="outline" asChild>
            <Link to="/groups" search={{ tenant: tenantKey }}>
              {t("common.cancel")}
            </Link>
          </Button>
          <Button type="submit" disabled={ed.pending || !online}>
            {t("groups.create.submit")}
          </Button>
        </div>
      </form>
      <UnsavedGuard dirty={ed.form.formState.isDirty} />
    </FormProvider>
  );
}
