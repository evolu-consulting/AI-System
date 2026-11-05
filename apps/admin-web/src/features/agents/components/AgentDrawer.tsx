// CR-121 C-1b · ngăn tóm tắt một Agent (mở khi bấm hàng). Agent chưa có trang chi tiết riêng nên không có liên kết "Mở trang chi tiết".
import type { AgentGrantRow, AgentSettingsItem } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { DetailDrawer } from "@/components/shared/list/DetailDrawer";
import { pickLocalized } from "@/lib/localized";
import { isActive, modelText, runtimeKey } from "../lib/agents";
import { WhoCell } from "./AgentCells";

type Props = {
  item: AgentSettingsItem | null;
  rows: readonly AgentGrantRow[];
  entitled: boolean;
  onClose: () => void;
};

export function AgentDrawer({ item, rows, entitled, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const rt = item ? runtimeKey(item.runtime) : null;
  return (
    <DetailDrawer
      open={!!item}
      onClose={onClose}
      kind={t("agents.drawer.kind")}
      title={item ? pickLocalized(item.agent.name, i18n.language) : ""}
      status={
        item
          ? {
              label: isActive(item) ? t("common.on") : t("common.off"),
              tone: isActive(item) ? "ok" : "off",
            }
          : undefined
      }
      line={item ? <span className="font-mono">@{item.agent.key}</span> : undefined}
      facts={
        item
          ? [
              {
                k: t("agents.drawer.model"),
                v: modelText(item.model) ?? t("agents.model.cliDefault"),
              },
              { k: t("agents.drawer.runtime"), v: rt ? t(rt) : item.runtime },
              { k: t("agents.drawer.entitled"), v: entitled ? t("common.on") : t("common.off") },
              { k: t("agents.drawer.who"), v: <WhoCell item={item} rows={rows} /> },
            ]
          : []
      }
    />
  );
}
