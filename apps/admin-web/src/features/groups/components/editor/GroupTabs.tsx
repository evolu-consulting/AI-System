// ADM-FR-62 · 3 tab của editor Group: Thành viên · Feature · Agent. Tab nằm trên URL (`?tab=`); nội dung tab Thành viên/Feature do FE2c/FE2d nối.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentTab } from "./AgentTab";

export type GroupTab = "members" | "features" | "agents";

type Props = {
  tab: GroupTab;
  onTab: (tab: GroupTab) => void;
  members: ReactNode;
  features: ReactNode;
};

export function GroupTabs({ tab, onTab, members, features }: Props) {
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
        <AgentTab />
      </TabsContent>
    </Tabs>
  );
}
