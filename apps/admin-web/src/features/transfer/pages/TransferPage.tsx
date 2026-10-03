// ADM-FR-54 · /transfer: Tabs Export · Import (FE5b dựng nội dung Import). Chỉ platform_admin.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExportTab } from "../components/ExportTab";

function TransferContent() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("export");
  return (
    <>
      <PageHeader title={t("transfer.title")} description={t("transfer.subtitle")} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="export">{t("transfer.tab.export")}</TabsTrigger>
          <TabsTrigger value="import">{t("transfer.tab.import")}</TabsTrigger>
        </TabsList>
        <TabsContent value="export" className="mt-4">
          <ExportTab />
        </TabsContent>
        <TabsContent value="import" className="mt-4" />
      </Tabs>
    </>
  );
}

export function TransferPage() {
  return (
    <PlatformOnly>
      <TransferContent />
    </PlatformOnly>
  );
}
