// CR-121 c12 · R3 · MỘT hàng app của bảng: Ứng dụng · Quyền truy cập · Trạng thái (+ lý do) · Thành viên · Quy trình ("2 bật · 1 tắt").
// Chi tiết (tính năng thêm + thông tin gói/vai) mở dưới hàng. Chữ dài cắt + tooltip.
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentProps } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { APPS } from "@/features/features/lib/feature-meta";
import { useTr } from "@/lib/use-translate";
import { AddonList } from "../../components/features/AddonList";
import { AppCardMeta } from "../../components/features/AppCardMeta";
import { useJobName } from "../../flows/lib/use-job-name";
import {
  type AppCard,
  type AppLevel,
  availableLevels,
  detectLevel,
  setKey,
} from "../../lib/feature-assign";
import { type FlowCount, isAppOn, rowStatus } from "../lib/apps-table";
import { LevelControl } from "./LevelControl";

type Meta = Omit<ComponentProps<typeof AppCardMeta>, "app" | "level">;
export type AppRowProps = {
  card: AppCard;
  draft: ReadonlySet<string>;
  readOnly: boolean;
  members: number | null;
  meta: Meta | null;
  flows: FlowCount | undefined;
  offSlots: readonly string[];
  onChange: (next: Set<string>) => void;
  onLevel: (card: AppCard, level: AppLevel) => void;
  onOpenFlows: () => void;
};

/** Lý do chỉ hiện khi KHÁC hiển nhiên (bật mà thiếu quy trình, quyền không chuẩn); "Đang bật/Đang tắt" tự nói lên. */
function StatusCell({ s }: { s: ReturnType<typeof rowStatus> }) {
  const { t } = useTranslation();
  const jobName = useJobName();
  const tone = s.kind === "on" ? "ok" : s.kind === "off" ? "off" : "warn";
  const reason =
    s.kind === "attention"
      ? t("tenants.apps.reason.jobOff", { job: jobName({ slot: s.slot }) })
      : s.kind === "nonstandard"
        ? t("tenants.features.nonstandardHint")
        : null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1" data-status={s.kind}>
      <StatusBadge tone={tone}>{t(`tenants.apps.status.${s.kind}`)}</StatusBadge>
      {reason ? (
        <span className="min-w-0 truncate text-caption text-muted-foreground" title={reason}>
          {`· ${reason}`}
        </span>
      ) : null}
    </span>
  );
}

function Access({
  p,
  name,
  level,
}: {
  p: AppRowProps;
  name: string;
  level: ReturnType<typeof detectLevel> | null;
}) {
  const { t } = useTranslation();
  const { card, draft, readOnly } = p;
  if (card.mode === "levels")
    return (
      <LevelControl
        value={level?.level ?? "off"}
        available={availableLevels(card)}
        ariaLabel={t("tenants.features.levelAria", { name })}
        disabled={readOnly}
        onChange={(l) => p.onLevel(card, l)}
      />
    );
  if (card.mode === "core")
    return <Switch checked disabled aria-label={t("tenants.features.coreAria")} />;
  if (card.mode === "switch" && card.main) {
    const main = card.main;
    return (
      <Switch
        checked={draft.has(main.key)}
        disabled={readOnly}
        aria-label={t("tenants.features.switchAria", { name })}
        onCheckedChange={(on) => {
          const next = setKey(draft, main.key, on);
          if (!on) for (const f of card.addons) next.delete(f.key);
          p.onChange(next);
        }}
      />
    );
  }
  return null; // dạng danh sách: chỉnh từng tính năng ở phần chi tiết (mũi tên cuối hàng), không thêm chữ
}

function DetailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const label = t(open ? "tenants.apps.hideDetail" : "tenants.apps.showDetail");
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="ml-auto"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      {open ? (
        <ChevronUp aria-hidden className="size-4" />
      ) : (
        <ChevronDown aria-hidden className="size-4" />
      )}
    </Button>
  );
}

export const ROW_GRID =
  "grid grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1.6fr)_5.5rem_minmax(0,1.3fr)] items-center gap-4";

export function AppRow(p: AppRowProps) {
  const { t } = useTranslation();
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const { card } = p;
  const Icon = APPS[card.app].icon;
  const name = tr(`featmeta.app.${card.app}.name`);
  const level = card.mode === "levels" ? detectLevel(card, p.draft) : null;
  const isOn = isAppOn(card, p.draft);
  const status = rowStatus(
    card,
    level,
    isOn,
    p.offSlots.map((slot) => ({ app: card.app, slot })),
  );
  const appOff = card.mode === "levels" ? level?.level === "off" : card.mode === "switch" && !isOn;
  const hasDetail = card.addons.length > 0 || !!p.meta;
  return (
    <div className="border-t border-border" data-testid={`apps-row-${card.app}`}>
      <div className={`${ROW_GRID} min-h-14 px-3 py-2`}>
        <span className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-label font-medium" title={name}>
            {name}
          </span>
        </span>
        <div className="min-w-0">
          <Access p={p} name={name} level={level} />
        </div>
        <StatusCell s={status} />
        <span className="text-body">{p.members ?? "—"}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {p.flows ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto min-w-0 p-0"
              data-testid={`apps-flows-${card.app}`}
              onClick={p.onOpenFlows}
            >
              <span className="truncate">
                {t("tenants.apps.flowsCount", { on: p.flows.on, total: p.flows.on + p.flows.off })}
              </span>
            </Button>
          ) : (
            "—"
          )}
          {hasDetail ? <DetailToggle open={open} onToggle={() => setOpen(!open)} /> : null}
        </span>
      </div>
      {open ? (
        <div className="space-y-3 bg-muted/30 px-3 py-3">
          <AddonList
            items={card.addons}
            draft={p.draft}
            locked={appOff || p.readOnly}
            showAddonBadge={card.mode !== "list"}
            onToggle={(key, on) => p.onChange(setKey(p.draft, key, on))}
          />
          {p.meta ? <AppCardMeta {...p.meta} app={card.app} level={level?.level ?? "off"} /> : null}
        </div>
      ) : null}
    </div>
  );
}
