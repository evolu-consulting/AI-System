// HUB-FR-78 · CR-054 · ngăn phải "Cấp quyền · <agent>": Phạm vi (Cả công ty | Chọn nhóm và người), checkbox nhóm/người,
// dòng tóm tắt, Huỷ / Lưu (Lưu = POST/DELETE chênh lệch ở hook).
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { pickLocalized } from "@/lib/localized";
import type { GrantSheetState } from "../hooks/use-grant-sheet";
import { type GrantScope, toggleIn } from "../lib/grant-draft";
import { SubjectList } from "./GrantSubjects";

function ScopeRadio({ value, onChange }: { value: GrantScope; onChange: (v: GrantScope) => void }) {
  const { t } = useTranslation();
  const option = (v: GrantScope, title: string, note: string) => (
    <div className="flex items-start gap-2">
      <RadioGroupItem id={`grant-scope-${v}`} value={v} className="mt-0.5" />
      <Label htmlFor={`grant-scope-${v}`} className="flex flex-col items-start gap-0.5 font-normal">
        <span className="font-medium">{title}</span>
        <span className="text-label text-muted-foreground">{note}</span>
      </Label>
    </div>
  );
  return (
    <RadioGroup
      aria-label={t("agents.grant.scope")}
      value={value}
      onValueChange={(v) => onChange(v === "all" ? "all" : "some")}
      className="gap-3"
    >
      {option("all", t("agents.grant.all"), t("agents.grant.allNote"))}
      {option("some", t("agents.grant.some"), t("agents.grant.someNote"))}
    </RadioGroup>
  );
}

function Summary({ s, agent }: { s: GrantSheetState; agent: string }) {
  const { t } = useTranslation();
  const sel = s.open?.sel;
  if (!sel) return null;
  if (sel.scope === "all") return <>{t("agents.grant.summaryAll", { agent })}</>;
  const members = (s.groups.data ?? [])
    .filter((g) => sel.groups.has(g.id))
    .reduce((n, g) => n + g.member_count, 0);
  if (sel.groups.size === 0 && sel.users.size === 0)
    return <>{t("agents.grant.summaryNone", { agent })}</>;
  return (
    <>
      {t("agents.grant.summarySome", {
        agent,
        groups: String(sel.groups.size),
        members: String(members),
        users: String(sel.users.size),
      })}
    </>
  );
}

export function GrantSheet({ s }: { s: GrantSheetState }) {
  const { t, i18n } = useTranslation();
  const open = s.open;
  const lang = i18n.language;
  const agent = open ? pickLocalized(open.item.agent.name, lang) : "";
  const sel = open?.sel;
  const groups = s.groups.data?.map((g) => ({
    id: g.id,
    label: pickLocalized(g.name, lang),
    meta: t("agents.grant.members", { n: String(g.member_count) }),
  }));
  const users = s.users.data?.map((u) => ({ id: u.id, label: u.name, meta: `@${u.username}` }));
  return (
    <Sheet open={open !== null} onOpenChange={(o) => !o && s.close()}>
      <SheetContent className="w-full gap-0 sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>{t("agents.grant.title", { agent })}</SheetTitle>
          <SheetDescription>{t("agents.grant.subtitle")}</SheetDescription>
        </SheetHeader>
        {sel ? (
          <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
            <ScopeRadio value={sel.scope} onChange={(scope) => s.change({ ...sel, scope })} />
            {sel.scope === "some" ? (
              <>
                <SubjectList
                  title={t("agents.grant.groups")}
                  idPrefix="grant-group"
                  options={groups}
                  loading={s.groups.isPending}
                  failed={s.groups.isError}
                  empty={t("agents.grant.noGroups")}
                  checked={sel.groups}
                  onToggle={(id, on) => s.change({ ...sel, groups: toggleIn(sel.groups, id, on) })}
                />
                <SubjectList
                  title={t("agents.grant.users")}
                  idPrefix="grant-user"
                  options={users}
                  loading={s.users.isPending}
                  failed={s.users.isError}
                  empty={t("agents.grant.noUsers")}
                  checked={sel.users}
                  onToggle={(id, on) => s.change({ ...sel, users: toggleIn(sel.users, id, on) })}
                />
              </>
            ) : null}
            <p className="text-label text-muted-foreground" aria-live="polite">
              <Summary s={s} agent={agent} />
            </p>
          </div>
        ) : null}
        <SheetFooter className="flex-row justify-end border-t border-border">
          <Button variant="outline" onClick={s.close} disabled={s.saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void s.submit()} disabled={s.saving}>
            {t("common.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
