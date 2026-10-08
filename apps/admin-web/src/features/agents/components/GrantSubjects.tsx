// HUB-FR-78 · CR-054 · danh sách checkbox Nhóm + Người của ngăn Cấp quyền (dữ liệu từ hook, component không fetch).
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export type SubjectOption = { id: string; label: string; meta: string };

type ListProps = {
  title: string;
  idPrefix: string;
  options: SubjectOption[] | undefined;
  loading: boolean;
  failed: boolean;
  empty: string;
  checked: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
};

function Body(p: ListProps) {
  const { t } = useTranslation();
  if (p.failed)
    return <p className="text-label text-destructive">{t("agents.grant.loadFailed")}</p>;
  if (p.loading || !p.options) return <Skeleton className="h-16 w-full" />;
  if (p.options.length === 0) return <p className="text-label text-muted-foreground">{p.empty}</p>;
  return p.options.map((o) => {
    const id = `${p.idPrefix}-${o.id}`;
    return (
      <div key={o.id} className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={p.checked.has(o.id)}
          onCheckedChange={(v) => p.onToggle(o.id, v === true)}
        />
        <Label htmlFor={id} className="font-normal">
          {o.label} <span className="text-label text-muted-foreground">· {o.meta}</span>
        </Label>
      </div>
    );
  });
}

export function SubjectList(p: ListProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-label font-medium text-muted-foreground">{p.title}</legend>
      <div className="max-h-56 space-y-2 overflow-y-auto">
        <Body {...p} />
      </div>
    </fieldset>
  );
}
