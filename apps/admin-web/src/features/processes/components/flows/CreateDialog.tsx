// CR-120 · "Tạo quy trình": làm mới từ trống, hoặc "Tạo từ mẫu" (mẫu toàn nền tảng chép về công ty — trước đây là tab "Mẫu · chạy thử").
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LibraryListItem } from "../../library-api";
import type { RowActions } from "../ProcessesTable";

const k = (s: string) => `process.admin.flows.create.${s}`;

export default function CreateDialog(p: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templates: readonly LibraryListItem[];
  actions: RowActions;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent data-testid="flows-create-dialog">
        <DialogHeader>
          <DialogTitle>{t("process.admin.list.create")}</DialogTitle>
          <DialogDescription>{t(k("lead"))}</DialogDescription>
        </DialogHeader>
        <Button asChild>
          <Link to="/processes/new" onClick={() => p.onOpenChange(false)}>
            {t(k("blank"))}
          </Link>
        </Button>
        <h3 className="text-label font-semibold">{t(k("fromTemplate"))}</h3>
        {p.templates.length === 0 ? (
          <p className="text-body text-muted-foreground">
            {t("process.admin.list.emptyTemplates")}
          </p>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto" data-testid="flows-templates">
            {p.templates.map((tpl) => (
              <li
                key={tpl.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
                data-testid={`flows-template-${tpl.key}`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-label font-medium">{tpl.name}</span>
                  <span className="font-mono text-caption text-muted-foreground">!{tpl.key}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => p.actions.onCopy(tpl)}>
                  {t("process.admin.list.copy")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
