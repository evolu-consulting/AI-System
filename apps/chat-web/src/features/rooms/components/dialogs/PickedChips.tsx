// HUB-FR-96 · `list "Thành viên đã chọn"` + đếm `status` "n / 50 · gồm bạn" của hộp Tạo nhóm.
import type { DirectoryUser } from "@ai/contracts/chat";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  selfName: string;
  picked: DirectoryUser[];
  full: boolean;
  onRemove: (user: DirectoryUser) => void;
};

export function PickedChips({ selfName, picked, full, onRemove }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{t("rooms.newGroup.members")}</span>
      <ul aria-label={t("rooms.newGroup.picked")} className="flex flex-wrap gap-1.5">
        <li className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
          {t("rooms.newGroup.selfOwner", { name: selfName })}
        </li>
        {picked.map((u) => (
          <li
            key={u.id}
            className="flex items-center gap-1 rounded-full bg-muted py-1 pl-2.5 pr-1 text-xs font-medium"
          >
            {u.display_name}
            <button
              type="button"
              aria-label={t("rooms.newGroup.remove", { name: u.display_name })}
              onClick={() => onRemove(u)}
              className="rounded-full p-0.5 outline-none hover:bg-border focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <p role="status" className="text-xs text-muted-foreground">
        {t("rooms.newGroup.count", { n: picked.length + 1 })}
        {full && ` · ${t("rooms.newGroup.full")}`}
      </p>
    </div>
  );
}
