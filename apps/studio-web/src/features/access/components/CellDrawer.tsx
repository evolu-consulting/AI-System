// HUB-FR-78 · drawer chỉ đọc của một ô: Ngày cấp, Người cấp, grant trong tenant (spec §3 C `GET /agent-entitlements/:a/:t`).
import { useTranslation } from "react-i18next";
import { ErrorState } from "#/components/shared/ErrorState";
import { Button } from "#/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { Skeleton } from "#/components/ui/skeleton";
import type { CellTarget } from "../hooks/use-access-mutations";
import { useCellDetail } from "../hooks/use-cell-detail";

const fmt = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleString(locale) : "—";

function Body({ target }: { target: CellTarget }) {
  const { t, i18n } = useTranslation();
  const q = useCellDetail(target);
  if (q.error) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton aria-busy="true" className="h-24 w-full" />;
  const d = q.data;
  return (
    <div className="space-y-4 px-4">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-body">
        <dt className="text-muted-foreground">{t("access.drawer.grantedAt")}</dt>
        <dd>{fmt(d.granted_at, i18n.language)}</dd>
        <dt className="text-muted-foreground">{t("access.drawer.grantedBy")}</dt>
        <dd>{d.granted_by?.username ?? "—"}</dd>
      </dl>
      <section className="space-y-2">
        <h3 className="font-medium text-foreground">{t("access.drawer.grants")}</h3>
        {d.grants.length === 0 ? (
          <p className="text-muted-foreground">{t("access.drawer.none")}</p>
        ) : (
          <ul className="space-y-1">
            {d.grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-baseline gap-2">
                <span className="text-label text-muted-foreground">
                  {t(`access.drawer.subject.${g.subject_type}`)}
                </span>
                <span>{g.subject.name}</span>
                <span className="text-label text-muted-foreground">
                  {g.granted_by_username ?? "—"} · {fmt(g.granted_at, i18n.language)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {d.grants_truncated ? (
          <p className="text-label text-muted-foreground">{t("access.truncated")}</p>
        ) : null}
      </section>
    </div>
  );
}

export function CellDrawer({
  target,
  onClose,
}: {
  target: CellTarget | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const names = { agent: target?.agentKey ?? "", tenant: target?.tenantKey ?? "" };
  return (
    <Sheet open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent showCloseButton={false} className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("access.drawer.title", names)}</SheetTitle>
          <SheetDescription>{t("access.drawer.note")}</SheetDescription>
        </SheetHeader>
        {target ? <Body target={target} /> : null}
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
