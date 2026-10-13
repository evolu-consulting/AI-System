// HUB-FR-66 · màn Models (ui-agent-studio §8): tab Providers | Profiles. `?tab=` chọn tab, `?drawer=new|<id>` mở Sheet provider.
// Tab Đơn giá không hiện (ngoài phạm vi, Q1). Profiles do T5c; CheckDialog/Runbook do T5b.
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { EmptyState } from "#/components/shared/EmptyState";
import { PageHeader } from "#/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { ProvidersPanel } from "../components/ProvidersPanel";

const route = getRouteApi("/_authed/models");
const TABS = ["providers", "profiles"] as const;

export function ModelsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tab = "providers", drawer } = route.useSearch();
  const go = (next: { tab?: (typeof TABS)[number]; drawer?: string }) =>
    void navigate({ to: "/models", search: next, replace: true });
  return (
    <>
      <PageHeader title={t("models.title")} subtitle={t("models.subtitle")} />
      <Tabs value={tab} onValueChange={(v) => go({ tab: v as (typeof TABS)[number] })}>
        <TabsList aria-label={t("models.tab.aria")}>
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`models.tab.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="providers">
          <ProvidersPanel drawer={drawer} onDrawer={(d) => go({ tab, drawer: d })} />
        </TabsContent>
        <TabsContent value="profiles">
          <EmptyState message={t("soon")} />
        </TabsContent>
      </Tabs>
    </>
  );
}
