// CR-104 · ops-ui · lịch sử 50 sự kiện: giờ, check, đổi trạng thái (từ → sang) hoặc "Đổi cấu hình bởi <người>".
import type { OpsEvent, OpsStatus } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isCheckKey } from "../lib/ops";
import { TONE, when } from "./CheckCard";

function Transition({ from, to }: { from: OpsStatus | null; to: OpsStatus | null }) {
  const { t } = useTranslation();
  const badge = (s: OpsStatus | null) =>
    s ? <StatusBadge tone={TONE[s]}>{t(`system.status.${s}`)}</StatusBadge> : "—";
  return (
    <span className="inline-flex items-center gap-2">
      {badge(from)}→{badge(to)}
    </span>
  );
}
type Props = { events: readonly OpsEvent[]; actorOf: (id: string | null) => string };

export function HistoryTable({ events, actorOf }: Props) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="sys-history" className="space-y-2">
      <h2 id="sys-history" className="text-lg font-semibold">
        {t("system.history.title")}
      </h2>
      <Table aria-label={t("system.history.title")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("system.history.time")}</TableHead>
            <TableHead>{t("system.history.check")}</TableHead>
            <TableHead>{t("system.history.change")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground">
                {t("system.history.empty")}
              </TableCell>
            </TableRow>
          ) : (
            events.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{when(e.at)}</TableCell>
                <TableCell>
                  {e.check_key && isCheckKey(e.check_key)
                    ? t(`system.check.${e.check_key}`)
                    : (e.check_key ?? "—")}
                </TableCell>
                <TableCell>
                  {e.kind === "settings_changed" ? (
                    t("system.history.settings", { user: actorOf(e.actor_user_id) })
                  ) : (
                    <Transition from={e.from_status} to={e.to_status} />
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}
