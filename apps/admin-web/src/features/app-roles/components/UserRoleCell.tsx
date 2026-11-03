// CR-112 · ADM-FR-82 · ô "Vai theo ứng dụng" của một người: chip vai (gỡ được) + chọn "Gán vào vai…" (ghi vào bản nháp).
import type { User } from "@ai/contracts";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { packNameKey, roleLabel, sortPacks } from "../lib/levels";
import type { RoleView } from "../lib/view";

type Props = {
  user: Pick<User, "id" | "username" | "display_name">;
  mine: RoleView[];
  all: RoleView[];
  savedGroupIds: ReadonlySet<string>;
  onToggle: (ref: string, saved: boolean, want: boolean) => void;
};

export function useRoleName() {
  const { t, i18n } = useTranslation();
  return (v: RoleView): string => {
    const l = roleLabel(v, i18n.language);
    const base = "key" in l ? t(l.key) : l.text;
    const app = packNameKey(v.pack);
    return `${base} · ${app ? t(app) : v.pack}`;
  };
}

export function UserRoleCell({ user, mine, all, savedGroupIds, onToggle }: Props) {
  const { t } = useTranslation();
  const name = useRoleName();
  const mineRefs = new Set(mine.map((m) => m.ref));
  const free = all.filter((v) => !v.deleted && !mineRefs.has(v.ref));
  const packs = sortPacks([...new Set(free.map((v) => v.pack))]);
  const saved = (v: RoleView) => v.groupId !== null && savedGroupIds.has(v.groupId);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {mine.map((v) => (
        <StatusBadge key={v.ref} tone={v.effective ? "info" : "warn"}>
          {name(v)}
          <button
            type="button"
            aria-label={t("appRoles.user.removeAria", { user: user.username, role: name(v) })}
            className="ml-1 rounded hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => onToggle(v.ref, saved(v), false)}
          >
            <X aria-hidden className="size-3" />
          </button>
        </StatusBadge>
      ))}
      {free.length > 0 ? (
        <select
          aria-label={t("appRoles.user.assignAria", { user: user.username })}
          value=""
          className="h-7 rounded-md border border-input bg-transparent px-2 text-label"
          onChange={(e) => {
            const v = free.find((x) => x.ref === e.target.value);
            if (v) onToggle(v.ref, saved(v), true);
          }}
        >
          <option value="">{t("appRoles.user.assign")}</option>
          {packs.map((p) => {
            const key = packNameKey(p);
            return (
              <optgroup key={p} label={key ? t(key) : p}>
                {free
                  .filter((v) => v.pack === p)
                  .map((v) => (
                    <option key={v.ref} value={v.ref}>
                      {name(v)}
                    </option>
                  ))}
              </optgroup>
            );
          })}
        </select>
      ) : null}
    </div>
  );
}
