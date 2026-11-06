// CR-121 C-3b · ô "Cần xử lý ngay" (việc nào, bao nhiêu, bấm đi đâu) và ô "Sức khoẻ hệ thống" (4 chỉ báo + mức).
import type { OpsOverview } from "@ai/contracts/hub-admin";
import { Link } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  type AttentionRow,
  attentionRows,
  type HealthLevel,
  healthTiles,
} from "../../lib/ops-overview";
import { BentoTile, type TileError } from "./BentoTile";

type Common = { loading: boolean; error: TileError | null };

function Row({ r }: { r: AttentionRow }) {
  const { t } = useTranslation();
  const body = (
    <>
      <i aria-hidden className="size-2 shrink-0 rounded-full bg-warning-solid" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">
          {t(`overview.ops.attention.${r.key}.title`, r.params)}
        </span>
        <span className="block text-caption text-muted-foreground">
          {t(`overview.ops.attention.${r.key}.${r.link ? "sub" : "subNoLink"}`, r.params)}
        </span>
      </span>
      <span className="font-mono text-xl font-medium tabular-nums text-warning">{r.count}</span>
      {r.link ? <ChevronRight aria-hidden className="size-4 text-muted-foreground" /> : null}
    </>
  );
  const cls = "flex items-center gap-3 rounded-lg px-2 py-2";
  return r.link ? (
    <Link to={r.link.to} search={r.link.search as never} className={cn(cls, "hover:bg-muted")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function AttentionTile({ a, ...c }: Common & { a?: OpsOverview["attention"] }) {
  const { t } = useTranslation();
  const rows = a ? attentionRows(a) : null;
  return (
    <BentoTile
      title={t("overview.ops.attention.title")}
      loading={c.loading}
      error={c.error}
      className="md:col-span-6 xl:col-span-8"
    >
      {rows ? (
        <>
          <ul
            aria-label={t("overview.ops.attention.title")}
            className="-mx-2 flex flex-col gap-0.5"
          >
            {rows.active.map((r) => (
              <li key={r.key}>
                <Row r={r} />
              </li>
            ))}
          </ul>
          {rows.active.length === 0 ? (
            <p className="text-body text-muted-foreground">
              {t("overview.ops.attention.allClear")}
            </p>
          ) : null}
          <ul className="mt-auto flex flex-col gap-1 pt-1">
            {rows.ok.map((k) => (
              <li key={k} className="flex items-center gap-2 text-caption text-muted-foreground">
                <Check aria-hidden className="size-3.5 text-success" />
                {t(`overview.ops.attention.${k}.ok`)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </BentoTile>
  );
}

const DOT: Record<HealthLevel, string> = {
  ok: "bg-success",
  warn: "bg-warning-solid",
  bad: "bg-danger",
  none: "bg-muted-foreground",
};

export function HealthTile({ h, ...c }: Common & { h?: OpsOverview["health"] }) {
  const { t, i18n } = useTranslation();
  const tiles = h ? healthTiles(h, i18n.language, "—") : [];
  return (
    <BentoTile
      title={t("overview.ops.health.title")}
      tip={t("overview.ops.health.tip")}
      loading={c.loading}
      error={c.error}
      className="md:col-span-6 xl:col-span-4"
    >
      <div className="grid flex-1 grid-cols-2 gap-1">
        {tiles.map((x) => (
          <Link
            key={x.key}
            to="/system-health"
            className="flex flex-col justify-center gap-0.5 rounded-lg p-2 hover:bg-muted"
          >
            <span className="flex items-center gap-2 text-caption text-muted-foreground">
              <i aria-hidden className={cn("size-2 rounded-full", DOT[x.level])} />
              {t(`overview.ops.health.${x.key}.name`)}
              <span className="sr-only">{t(`overview.ops.health.level.${x.level}`)}</span>
            </span>
            <span className="font-mono text-xl font-medium tabular-nums">
              {x.level === "none"
                ? x.value
                : t(`overview.ops.health.${x.key}.value`, { v: x.value })}
            </span>
            <span className="text-caption text-muted-foreground">
              {t(
                `overview.ops.health.${x.key}.${x.level === "none" ? "empty" : "detail"}`,
                x.detail,
              )}
            </span>
          </Link>
        ))}
      </div>
    </BentoTile>
  );
}
