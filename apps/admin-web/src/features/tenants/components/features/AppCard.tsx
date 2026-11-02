// CR-111 · thẻ một app trong tab Feature của công ty: tên + dòng tóm tắt "Đang: Sửa · 1 tính năng thêm", thanh mức hoặc công tắc, tính năng thêm.
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Switch } from "@/components/ui/switch";
import { APPS } from "@/features/features/lib/feature-meta";
import { useTr } from "@/lib/use-translate";
import {
  activeAddons,
  availableLevels,
  type AppCard as Card,
  detectLevel,
  setKey,
  setLevel,
} from "../../lib/feature-assign";
import { AddonList } from "./AddonList";
import { LevelControl } from "./LevelControl";

type Props = { card: Card; draft: ReadonlySet<string>; onChange: (next: Set<string>) => void };

function useSummary(card: Card, draft: ReadonlySet<string>) {
  const { t } = useTranslation();
  const state =
    card.mode === "levels"
      ? t(`tenants.features.level.${detectLevel(card, draft).level}`)
      : card.mode === "switch" || card.mode === "core"
        ? t(card.mode === "core" || draft.has(card.main?.key ?? "") ? "common.on" : "common.off")
        : t("tenants.features.summary.list", {
            on: card.addons.filter((f) => draft.has(f.key)).length,
            total: card.addons.length,
          });
  const n = activeAddons(card, draft);
  const extra =
    card.mode === "list" || n === 0
      ? ""
      : ` · ${t("tenants.features.summary.addons", { count: n })}`;
  return `${t("tenants.features.summary.now", { state })}${extra}`;
}

export function AppCard({ card, draft, onChange }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const Icon = APPS[card.app].icon;
  const name = tr(`featmeta.app.${card.app}.name`);
  const summary = useSummary(card, draft);
  const level = card.mode === "levels" ? detectLevel(card, draft) : null;
  const mainOn = draft.has(card.main?.key ?? "");
  const appOff =
    card.mode === "levels" ? level?.level === "off" : card.mode === "switch" && !mainOn;
  return (
    <section
      aria-label={name}
      className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-h3 font-semibold">
            {name}
            {card.mode === "core" ? (
              <StatusBadge tone="info">{t("features.default")}</StatusBadge>
            ) : null}
            {level && !level.consistent ? (
              <StatusBadge tone="warn" tooltip={t("tenants.features.nonstandardHint")}>
                {t("tenants.features.nonstandard")}
              </StatusBadge>
            ) : null}
          </h3>
          <p className="text-caption text-muted-foreground">{summary}</p>
        </div>
        {card.mode === "core" ? (
          <Switch checked disabled aria-label={t("tenants.features.coreAria")} />
        ) : card.mode === "switch" && card.main ? (
          <Switch
            checked={mainOn}
            aria-label={t("tenants.features.switchAria", { name })}
            onCheckedChange={(on) => {
              const next = setKey(draft, (card.main as { key: string }).key, on);
              if (!on) for (const f of card.addons) next.delete(f.key);
              onChange(next);
            }}
          />
        ) : null}
      </div>
      {card.mode === "levels" ? (
        <LevelControl
          value={level?.level ?? "off"}
          available={availableLevels(card)}
          ariaLabel={t("tenants.features.levelAria", { name })}
          onChange={(l) => onChange(setLevel(draft, card, l))}
        />
      ) : null}
      <AddonList
        items={card.addons}
        draft={draft}
        locked={appOff}
        showAddonBadge={card.mode !== "list"}
        onToggle={(key, on) => onChange(setKey(draft, key, on))}
      />
    </section>
  );
}
