// HUB-FR-66 · màn Models (ui-agent-studio §8): tab Providers | Profiles. `?tab=` chọn tab, `?drawer=new|<id>` mở Sheet provider,
// `?guide=<id>` mở Runbook (D6). CheckDialog dùng chung cho hàng và Runbook (D3). Tab Đơn giá không hiện (Q1).
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "#/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { CheckDialog } from "../components/CheckDialog";
import { ProfilesPanel } from "../components/ProfilesPanel";
import { ProvidersPanel } from "../components/ProvidersPanel";
import { RunbookSheet } from "../components/RunbookSheet";
import { useCheckProvider } from "../hooks/use-check-provider";
import { useProviders } from "../hooks/use-providers";

const route = getRouteApi("/_authed/models");
const TABS = ["providers", "profiles"] as const;
type Search = { tab?: (typeof TABS)[number]; drawer?: string; guide?: string };

export function ModelsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tab = "providers", drawer, guide } = route.useSearch();
  const check = useCheckProvider();
  const providers = useProviders();
  const guided = guide ? (providers.data?.items.find((p) => p.id === guide) ?? null) : null;
  const go = (next: Search) => void navigate({ to: "/models", search: next, replace: true });
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
          <ProvidersPanel
            drawer={drawer}
            onDrawer={(d) => go({ tab, drawer: d })}
            onCheck={(p) => void check.start(p)}
            onGuide={(p) => go({ tab, guide: p.id })}
          />
        </TabsContent>
        <TabsContent value="profiles">
          <ProfilesPanel />
        </TabsContent>
      </Tabs>
      <CheckDialog
        state={check.state}
        onClose={check.close}
        onRecheck={(p) => void check.start(p)}
      />
      <RunbookSheet
        provider={guided}
        onClose={() => go({ tab })}
        onCheck={(p) => {
          go({ tab });
          void check.start(p);
        }}
      />
    </>
  );
}
