// CR-111 · một nhóm app trong danh mục Feature: tiêu đề (icon app, tên, mô tả) + bảng tên dễ hiểu / mô tả / trạng thái / key kỹ thuật.
import { type FeatureListItem, getAppManifest } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTr } from "@/lib/use-translate";
import type { FeatureStatusFilter } from "../hooks/use-feature-queries";
import { featureText } from "../lib/feature-label";
import { APPS, type AppGroup, metaOf } from "../lib/feature-meta";
import { FeatureRowMenu } from "./FeatureRowMenu";

const TONE: Record<FeatureStatusFilter, StatusTone> = { on: "ok", beta: "info", off: "off" };

type Props = {
  group: AppGroup<FeatureListItem>;
  isFetching: boolean;
  onStatus: (f: FeatureListItem, status: FeatureStatusFilter) => void;
  onDelete: (f: FeatureListItem) => void;
};

export function FeatureGroupSection({ group, isFetching, onStatus, onDelete }: Props) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const Icon = APPS[group.app].icon;
  const appName = tr(`featmeta.app.${group.app}.name`);
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-h3 font-semibold">{appName}</h2>
          <p className="text-caption text-muted-foreground">
            {tr(`featmeta.app.${group.app}.desc`)}
          </p>
        </div>
        {getAppManifest(group.app) ? (
          <Link
            to="/apps/$appKey"
            params={{ appKey: group.app }}
            search={{ tab: "features" }}
            className="ml-auto text-label text-primary hover:underline"
          >
            {t("appcfg.openApp")}
          </Link>
        ) : null}
        <span
          className={
            getAppManifest(group.app)
              ? "text-label text-muted-foreground"
              : "ml-auto text-label text-muted-foreground"
          }
        >
          {group.items.length}
        </span>
      </header>
      <Table
        containerClassName="overflow-visible"
        className={isFetching ? "opacity-60" : undefined}
      >
        <caption className="sr-only">{`${t("features.list.title")} · ${appName}`}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("features.col.name")}</TableHead>
            <TableHead>{t("features.col.status")}</TableHead>
            <TableHead>{t("features.col.usage")}</TableHead>
            <TableHead className="text-right">{t("features.col.key")}</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">{t("common.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.items.map((f) => {
            const text = featureText(tr, i18n.language, f);
            return (
              <TableRow key={f.id}>
                <TableCell className="max-w-md whitespace-normal">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      to="/features/$featureId"
                      params={{ featureId: f.id }}
                      className="font-medium text-foreground hover:underline"
                    >
                      {text.name}
                    </Link>
                    {f.is_core ? (
                      <StatusBadge tone="info">{t("features.default")}</StatusBadge>
                    ) : null}
                    {metaOf(f.key).addon ? (
                      <StatusBadge tone="warn">{t("features.addon")}</StatusBadge>
                    ) : null}
                  </div>
                  {text.desc ? (
                    <p className="mt-0.5 text-caption text-muted-foreground">{text.desc}</p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={TONE[f.status]}>
                    {t(`features.status.${f.status}`)}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {f.is_core
                    ? t("features.allTenants")
                    : t("features.usage", { commands: f.command_count, tenants: f.tenant_count })}
                </TableCell>
                <TableCell className="text-right font-mono text-caption text-muted-foreground">
                  {" "}
                  {f.key}
                </TableCell>
                <TableCell className="text-right">
                  <FeatureRowMenu feature={f} onStatus={onStatus} onDelete={onDelete} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
