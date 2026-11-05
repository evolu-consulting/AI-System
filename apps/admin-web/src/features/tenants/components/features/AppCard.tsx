// CR-111 · thẻ một app trong tab Feature của công ty: tên + dòng tóm tắt "Đang: Sửa · 1 tính năng thêm", thanh mức hoặc công tắc, tính năng thêm.
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Switch } from "@/components/ui/switch";
import { APPS } from "@/features/features/lib/feature-meta";
import { useTr } from "@/lib/use-translate";
import {
  addonsWithoutEngine,
  ENGINE_KEY,
  type EngineToggle,
  engineOf,
} from "../../lib/engine-toggle";
import {
  type AppLevel,
  activeAddons,
  availableLevels,
  type AppCard as Card,
  detectLevel,
  setKey,
} from "../../lib/feature-assign";
import { AddonList } from "./AddonList";
import { AppCardMeta } from "./AppCardMeta";
import { LevelControl } from "./LevelControl";

type Props = {
  card: Card;
  draft: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Đặt mức: cũng ghi ý định bật/tắt gói (tab Ứng dụng & Gói). */
  onLevel: (card: Card, level: AppLevel) => void;
  readOnly?: boolean;
  /** Gói của app + số vai (tính theo mức đang chọn) + số công ty đối tác, khi app có gói. */
  meta?: Omit<ComponentProps<typeof AppCardMeta>, "app" | "level"> | null;
  /** CR-118: khối "Gán quy trình" của app nằm trong thẻ (cùng một component ở trang công ty và ngăn Công ty của trang app). */
  /** Hàm ⇒ nhận công tắc "Duyệt theo quy trình" (feature `contracts-approval-engine`, bỏ khỏi "Tính năng thêm") để đặt trong khối Quy trình. */
  slots?: ReactNode | ((engine: EngineToggle | null) => ReactNode);
  /** CR-118: lối tắt ở đầu thẻ (vd "Mở cấu hình app"). */
  headerAction?: ReactNode;
};

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

/** Công tắc bên phải thẻ: Cơ bản (luôn bật, khoá) hoặc Chat AI (một công tắc); app dạng mức/danh sách không có. */
function CardSwitch({
  card,
  draft,
  name,
  readOnly,
  onChange,
}: Pick<Props, "card" | "draft" | "readOnly" | "onChange"> & { name: string }) {
  const { t } = useTranslation();
  if (card.mode === "core")
    return <Switch checked disabled aria-label={t("tenants.features.coreAria")} />;
  const main = card.mode === "switch" ? card.main : undefined;
  if (!main) return null;
  return (
    <Switch
      checked={draft.has(main.key)}
      disabled={readOnly}
      aria-label={t("tenants.features.switchAria", { name })}
      onCheckedChange={(on) => {
        const next = setKey(draft, main.key, on);
        if (!on) for (const f of card.addons) next.delete(f.key);
        onChange(next);
      }}
    />
  );
}
/** App đang Tắt (mức Tắt, hoặc công tắc chính tắt) ⇒ khoá tính năng thêm. */
function isAppOff(
  card: Card,
  level: { level: string } | null,
  draft: ReadonlySet<string>,
): boolean {
  if (card.mode === "levels") return level?.level === "off";
  return card.mode === "switch" && !draft.has(card.main?.key ?? "");
}

export function AppCard({
  card,
  draft,
  onChange,
  onLevel,
  readOnly,
  meta,
  slots,
  headerAction,
}: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const Icon = APPS[card.app].icon;
  const name = tr(`featmeta.app.${card.app}.name`);
  const summary = useSummary(card, draft);
  const level = card.mode === "levels" ? detectLevel(card, draft) : null;
  const appOff = isAppOff(card, level, draft);
  const engine =
    typeof slots === "function"
      ? engineOf(card.addons, draft, appOff || !!readOnly, (on) =>
          onChange(setKey(draft, ENGINE_KEY, on)),
        )
      : null;
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
        {headerAction}
        <CardSwitch card={card} draft={draft} name={name} readOnly={readOnly} onChange={onChange} />
      </div>
      {card.mode === "levels" ? (
        <LevelControl
          value={level?.level ?? "off"}
          available={availableLevels(card)}
          ariaLabel={t("tenants.features.levelAria", { name })}
          disabled={readOnly}
          onChange={(l) => onLevel(card, l)}
        />
      ) : null}
      <AddonList
        items={engine ? addonsWithoutEngine(card.addons) : card.addons}
        draft={draft}
        locked={appOff || !!readOnly}
        showAddonBadge={card.mode !== "list"}
        onToggle={(key, on) => onChange(setKey(draft, key, on))}
      />
      {meta ? <AppCardMeta {...meta} app={card.app} level={level?.level ?? "off"} /> : null}
      {typeof slots === "function" ? slots(engine) : slots}
    </section>
  );
}
