// ADM-FR-62 · ADM-FR-37 · 3 tab của editor Group: Thành viên · Feature · Agent. Tab nằm trên URL (`?tab=`); nội dung tab Thành viên/Feature do FE2c/FE2d nối.
import type { Group } from "@ai/contracts";
import { lazy, type ReactNode, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Tab Agent nạp lười (plan-frontend §4): không vào chunk editor, chỉ gọi Hub khi tab được mở.
const AgentTab = lazy(() => import("./AgentTab").then((m) => ({ default: m.AgentTab })));

export type GroupTab = "members" | "features" | "agents";

type Props = {
  tab: GroupTab;
  onTab: (tab: GroupTab) => void;
  members: ReactNode;
  features: ReactNode;
  group: Group;
};

export function GroupTabs({ tab, onTab, members, features, group }: Props) {
  const { t } = useTranslation();
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as GroupTab)}>
      <TabsList>
        <TabsTrigger value="members">{t("groups.tab.members")}</TabsTrigger>
        <TabsTrigger value="features">{t("groups.tab.features")}</TabsTrigger>
        <TabsTrigger value="agents">{t("groups.tab.agents")}</TabsTrigger>
      </TabsList>
      <TabsContent value="members" className="pt-4">
        {members}
      </TabsContent>
      <TabsContent value="features" className="pt-4">
        {features}
      </TabsContent>
      <TabsContent value="agents" className="pt-4">
        <Suspense fallback={<Skeleton className="h-32 w-full" />}>
          <AgentTab group={group} />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
