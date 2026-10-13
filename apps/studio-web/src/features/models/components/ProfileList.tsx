// HUB-FR-67 · danh sách profile (cột trái): mỗi mục là `link` tên profile; mục đang mở có aria-current.
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import type { ProfileItem } from "../hooks/use-profiles";

type Props = {
  items: readonly ProfileItem[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
};

export function ProfileList({ items, selected, onSelect, onNew }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <Button className="w-full" onClick={onNew}>
        {t("models.profile.add")}
      </Button>
      <ul aria-label={t("models.profile.list.aria")} className="space-y-1">
        {items.map((p) => (
          <li key={p.id}>
            <a
              href={`?profile=${p.id}`}
              aria-current={p.id === selected ? "true" : undefined}
              className="flex items-center justify-between rounded-md px-3 py-2 font-mono text-body hover:bg-accent aria-[current=true]:bg-accent aria-[current=true]:font-medium"
              onClick={(e) => {
                e.preventDefault();
                onSelect(p.id);
              }}
            >
              <span>{p.key}</span>
              <span className="text-label text-muted-foreground">{p.steps.length}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
