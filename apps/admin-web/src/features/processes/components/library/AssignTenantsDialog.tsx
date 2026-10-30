// CR-105 · L3: "Gán cho tenant…" ngay trong quy trình. 1 tenant × 1 khe = đúng 1 quy trình ⇒ gán thay thế bản đang gán;
// bỏ chọn = về quy trình mặc định của khe. Tenant thiếu phòng ban theo mã ⇒ Hub 422 `SLOT_GROUPS_MISSING` (hiện mã thiếu, không gán).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAssignableTenants } from "../../hooks/use-assignable-tenants";
import { processErrorSpec } from "../../lib/errors";
import { assignPlan, detailsOf, errorLines, settledCounts } from "../../lib/library-view";
import {
  assignTenant,
  type LibraryDef,
  unassignTenant,
  useAssignments,
  useLibraryRefresh,
} from "../../library-api";

type Props = { def: LibraryDef; open: boolean; onClose: () => void };
type Failure = { tenant: string; message: string; lines: string[] };

export function AssignTenantsDialog({ def, open, onClose }: Props) {
  const { t } = useTranslation();
  const tenants = useAssignableTenants(open);
  const current = useAssignments(def.id, open);
  const refresh = useLibraryRefresh();
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [failures, setFailures] = useState<Failure[]>([]);
  const assignedIds = (current.data ?? []).map((a) => a.tenant_id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại ô chọn khi hộp mở / danh sách gán về
  useEffect(() => {
    if (open) {
      setSelected(assignedIds);
      setFailures([]);
    }
  }, [open, current.data]);
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)));
  const submit = async () => {
    const slot = def.slot;
    if (!slot) return;
    const plan = assignPlan(assignedIds, selected);
    const jobs = [
      ...plan.add.map((id) => ({ id, run: () => assignTenant(id, slot, def.id) })),
      ...plan.remove.map((id) => ({ id, run: () => unassignTenant(id, slot) })),
    ];
    setPending(true);
    const rs = await Promise.allSettled(jobs.map((j) => j.run()));
    setPending(false);
    void refresh();
    const bad = rs.flatMap((r, i): Failure[] => {
      if (r.status !== "rejected") return [];
      const id = jobs[i]?.id ?? "";
      const s = processErrorSpec(r.reason);
      return [
        {
          tenant: tenants.items.find((x) => x.id === id)?.name ?? id,
          message: t(s.key, s.params),
          lines: errorLines(detailsOf(r.reason)),
        },
      ];
    });
    setFailures(bad);
    const c = settledCounts(rs);
    if (c.ok > 0) notifySuccess(t("process.admin.library.assign.done", { n: c.ok }));
    if (bad.length === 0) onClose();
  };
  const items = tenants.items;
  const plan = assignPlan(assignedIds, selected);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("process.admin.library.assign.title", { name: def.name })}</DialogTitle>
          <DialogDescription>
            {t("process.admin.library.assign.body", { slot: def.slot_label ?? "" })}
          </DialogDescription>
        </DialogHeader>
        {tenants.isPending || current.isPending ? (
          <p className="text-body text-muted-foreground">{t("common.loading")}</p>
        ) : null}
        <ul className="max-h-72 space-y-1 overflow-y-auto" data-testid="assign-tenant-list">
          {items.map((x) => (
            <li key={x.id}>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={selected.includes(x.id)}
                  onCheckedChange={(c) => toggle(x.id, c === true)}
                />
                {x.name} <span className="font-mono text-label text-muted-foreground">{x.key}</span>
              </Label>
            </li>
          ))}
        </ul>
        {failures.length > 0 ? (
          <ul role="alert" className="space-y-1 text-label text-destructive">
            {failures.map((f) => (
              <li key={f.tenant}>
                {f.tenant}: {f.message}
                {f.lines.length > 0 ? (
                  <span className="font-mono text-caption"> ({f.lines.join("; ")})</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={pending || (plan.add.length === 0 && plan.remove.length === 0)}
          >
            {t("process.admin.library.assign.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
