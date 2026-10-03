// ADM-FR-36 · M3-R12 · nhóm "Command": "Thấy /x" kèm "qua feature F · group G"; command không thấy gom sau nút "Hiện … (n)" với "Vì sao không?".
import type { EffectiveCommand } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { type ExplainCtx, hiddenLines, visibleLines } from "./explain";
import { type ReasonActions, ReasonLines } from "./ReasonLines";

const LIMIT = 50;
type Props = { commands: EffectiveCommand[]; ctx: ExplainCtx; actions?: ReasonActions };

function HiddenRow({ c, ctx, actions }: { c: EffectiveCommand } & Omit<Props, "commands">) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <li className="space-y-1.5 px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono">{t("access.check.notSees", { name: `/${c.name}` })}</p>
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t(open ? "access.check.hideWhy" : "access.check.why")}
        </Button>
      </div>
      {open ? <ReasonLines lines={hiddenLines(c, ctx)} actions={actions} tone="problem" /> : null}
    </li>
  );
}

export function CommandSection({ commands, ctx, actions }: Props) {
  const { t } = useTranslation();
  const [showHidden, setShowHidden] = useState(false);
  const visible = commands.filter((c) => c.visible);
  const hidden = commands.filter((c) => !c.visible);
  const more = Math.max(0, visible.length - LIMIT);
  const moreHidden = Math.max(0, hidden.length - LIMIT);
  return (
    <section className="space-y-3">
      <h3 className="text-label font-semibold">{t("access.check.section.commands")}</h3>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {visible.slice(0, LIMIT).map((c) => (
          <li key={c.id} className="space-y-0.5 px-4 py-2.5">
            <p className="font-mono">{t("access.check.sees", { name: `/${c.name}` })}</p>
            <ReasonLines lines={visibleLines(c, ctx)} />
          </li>
        ))}
        {more > 0 ? (
          <li className="px-4 py-2 text-caption text-muted-foreground">
            {t("access.check.more", { count: more })}
          </li>
        ) : null}
      </ul>
      {hidden.length > 0 ? (
        <Button variant="outline" size="sm" onClick={() => setShowHidden(!showHidden)}>
          {showHidden
            ? t("access.check.hideHidden")
            : t("access.check.showHidden", { count: hidden.length })}
        </Button>
      ) : null}
      {showHidden ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-muted/30">
          {hidden.slice(0, LIMIT).map((c) => (
            <HiddenRow key={c.id} c={c} ctx={ctx} actions={actions} />
          ))}
          {moreHidden > 0 ? (
            <li className="px-4 py-2 text-caption text-muted-foreground">
              {t("access.check.more", { count: moreHidden })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
