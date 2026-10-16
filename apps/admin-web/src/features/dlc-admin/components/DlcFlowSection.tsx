// DLC-R14 · Workflow Process: khu "Flow nội tại AI SDLC" (bảng: flow, process, hỏi người, lane, mặc định, bật, thao tác)
// + nút "Thêm workflow" chọn loại (Dify → editor Dify có sẵn; AI SDLC → DlcWorkflowDialog).
import type { DlcWorkflow } from "@ai/contracts/hub-admin";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useDeleteDlcWorkflow, useDlcWorkflows, usePatchDlcWorkflow } from "../api";
import { DlcWorkflowDialog } from "./DlcWorkflowDialog";

type Editing = { workflow: DlcWorkflow | null } | null;

export function AddWorkflowMenu({ onAddDlc }: { onAddDlc: () => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="gap-1.5">
          {t("dlcAdmin.add")}
          <ChevronDown aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem asChild>
          <Link to="/workflows/new" className="flex flex-col items-start gap-0.5">
            <span className="font-medium">{t("dlcAdmin.addDify")}</span>
            <span className="text-micro text-muted-foreground">{t("dlcAdmin.addDifyHint")}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAddDlc} className="flex flex-col items-start gap-0.5">
          <span className="font-medium">{t("dlcAdmin.addDlc")}</span>
          <span className="text-micro text-muted-foreground">{t("dlcAdmin.addDlcHint")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row({
  w,
  onEdit,
  onDelete,
}: {
  w: DlcWorkflow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const patch = usePatchDlcWorkflow();
  const toggle = (enabled: boolean) =>
    patch.mutate(
      { id: w.id, patch: { enabled, version: w.version } },
      { onError: (e) => toast.error((e as Error).message) },
    );
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2.5">
        <div className="font-medium">{w.name}</div>
        <div className="text-micro text-muted-foreground">
          <span className="font-mono">#{w.key}</span>
          {w.description ? ` · ${w.description}` : null}
        </div>
      </td>
      <td className="px-3 py-2.5">{t(`dlcAdmin.process.${w.process}`)}</td>
      <td className="px-3 py-2.5">{t(`dlcAdmin.human.${w.human_mode ?? "engine"}`)}</td>
      <td className="px-3 py-2.5">{t(`dlcAdmin.lane.${w.lane ?? "auto"}`)}</td>
      <td className="px-3 py-2.5">
        {w.is_default ? <Badge variant="info">{t("dlcAdmin.col.default")}</Badge> : null}
      </td>
      <td className="px-3 py-2.5">
        <Switch
          checked={w.enabled}
          disabled={patch.isPending}
          aria-label={w.name}
          onCheckedChange={toggle}
        />
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <Button variant="outline" size="sm" onClick={onEdit}>
          {t("dlcAdmin.edit")}
        </Button>{" "}
        <Button variant="outline" size="sm" onClick={onDelete}>
          {t("dlcAdmin.delete")}
        </Button>
      </td>
    </tr>
  );
}

function Table({ items, onEdit, onDelete }: TableProps) {
  const { t } = useTranslation();
  const cols = ["name", "process", "human", "lane", "default", "enabled"] as const;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-label">
        <thead className="text-left text-muted-foreground">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {t(`dlcAdmin.col.${c}`)}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">{t("dlcAdmin.col.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <Row key={w.id} w={w} onEdit={() => onEdit(w)} onDelete={() => onDelete(w)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
type TableProps = {
  items: DlcWorkflow[];
  onEdit: (w: DlcWorkflow) => void;
  onDelete: (w: DlcWorkflow) => void;
};

/** `adding` do trang điều khiển (nút Thêm workflow ở PageHeader). */
export function DlcFlowSection({ adding, onAdded }: { adding: boolean; onAdded: () => void }) {
  const { t } = useTranslation();
  const list = useDlcWorkflows();
  const del = useDeleteDlcWorkflow();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<DlcWorkflow | null>(null);
  const current = adding ? { workflow: null } : editing;
  const close = () => {
    setEditing(null);
    onAdded();
  };
  const items = list.data?.items ?? [];
  return (
    <section className="mb-8 flex flex-col gap-3">
      <header>
        <h2 className="text-section-title font-semibold">{t("dlcAdmin.dlcSection")}</h2>
        <p className="text-label text-muted-foreground">{t("dlcAdmin.dlcSectionHint")}</p>
      </header>
      {items.length === 0 ? (
        <p className="text-label text-muted-foreground">{t("dlcAdmin.empty")}</p>
      ) : (
        <Table items={items} onEdit={(w) => setEditing({ workflow: w })} onDelete={setRemoving} />
      )}
      {current && (
        <DlcWorkflowDialog
          key={current.workflow?.id ?? "new"}
          open
          onOpenChange={(o) => !o && close()}
          workflow={current.workflow}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("dlcAdmin.deleteConfirm", { name: removing?.name ?? "" })}
        confirmLabel={t("dlcAdmin.delete")}
        destructive
        onConfirm={async () => {
          if (removing) await del.mutateAsync(removing.id);
          toast.success(t("dlcAdmin.deleted"));
        }}
      />
    </section>
  );
}
