// CR-120 §2 · FLOW-FR-03 · khai báo khe từ manifest app (mục đích, sự kiện mở lượt, luôn bật / cần add-on) + thẻ cảnh báo khi hub
// chưa có khe (chưa seed `process_slots` + def mặc định).
import type { AppSlotDecl } from "@ai/contracts/app-manifest";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";

export function SlotDeclInfo({ decl }: { decl: AppSlotDecl }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1" data-testid={`slot-decl-${decl.key}`}>
      <p className="text-body">{decl.purpose}</p>
      <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        <StatusBadge tone={decl.addon ? "off" : "ok"}>
          {decl.addon
            ? t("appcfg.processes.needsAddon", { addon: decl.addon })
            : t("appcfg.processes.alwaysOn")}
        </StatusBadge>
        <span>{t("appcfg.processes.trigger", { trigger: decl.trigger })}</span>
      </p>
    </div>
  );
}

export function MissingSlotCard({ decl }: { decl: AppSlotDecl }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={decl.label}
      data-testid={`app-slot-missing-${decl.key}`}
      className="space-y-3 rounded-xl border border-border bg-card p-4"
    >
      <header>
        <h3 className="text-h3 font-semibold">{decl.label}</h3>
        <p className="font-mono text-caption text-muted-foreground">{decl.key}</p>
      </header>
      <SlotDeclInfo decl={decl} />
      <p role="alert" className="text-body text-destructive">
        {t("appcfg.processes.slotMissing", { def: decl.defaultDefKey })}
      </p>
    </section>
  );
}
