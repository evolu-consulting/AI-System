// CR-121 C-1b · ngăn tóm tắt một Command (mở khi bấm hàng); chi tiết đầy đủ ở trang /commands/$commandId.
import type { CommandListItem } from "@ai/contracts/commands";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DetailDrawer } from "@/components/shared/list/DetailDrawer";
import { formatUpdated } from "@/lib/format";
import { pickLocalized } from "@/lib/localized";

type Props = { command: CommandListItem | null; onClose: () => void };

export function CommandDrawer({ command: c, onClose }: Props) {
  const { t, i18n } = useTranslation();
  return (
    <DetailDrawer
      open={!!c}
      onClose={onClose}
      kind={t("commands.list.drawer.kind")}
      title={c ? `/${c.name}` : ""}
      status={
        c
          ? { label: c.enabled ? t("common.on") : t("common.off"), tone: c.enabled ? "ok" : "off" }
          : undefined
      }
      line={c ? pickLocalized(c.description, i18n.language) : undefined}
      facts={
        c
          ? [
              ...(c.aliases.length
                ? [{ k: t("commands.list.drawer.aliases"), v: c.aliases.join(", ") }]
                : []),
              {
                k: t("commands.list.col.workflow"),
                v: <span className="font-mono">{c.workflow.key}</span>,
              },
              {
                k: t("commands.list.col.feature"),
                v: c.features.length
                  ? c.features.map((f) => pickLocalized(f.name, i18n.language)).join(", ")
                  : t("commands.list.noFeature"),
              },
              { k: t("commands.list.col.mode"), v: <span className="font-mono">{c.mode}</span> },
              { k: t("commands.list.col.updated"), v: formatUpdated(c.updated_at, c.updated_by) },
            ]
          : []
      }
      detail={
        c ? (
          <Link
            to="/commands/$commandId"
            params={{ commandId: c.id }}
            className="inline-flex items-center gap-1.5 hover:underline"
          >
            {t("common.list.openDetail")}
          </Link>
        ) : null
      }
    />
  );
}
