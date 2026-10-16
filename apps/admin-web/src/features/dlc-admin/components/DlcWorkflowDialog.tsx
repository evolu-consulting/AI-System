// DLC-R14 · thêm / sửa flow AI SDLC: key (chỉ khi thêm), tên, mô tả, process, hỏi người, lane, mặc định, bật; xem trước
// các bước của process (theo chiều chạy). Lỗi: KEY_TAKEN, VERSION_CONFLICT → câu riêng; khác → message.
import {
  DLC_PROCESSES,
  type DlcProcess,
  type DlcWorkflow,
  type DlcWorkflowCreate,
} from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/http";
import { useCreateDlcWorkflow, useDlcCatalog, usePatchDlcWorkflow } from "../api";
import { StepFlow, stepsOf } from "./StepFlow";

type Draft = Omit<DlcWorkflowCreate, "human_mode" | "lane"> & { human: string; laneSel: string };

const ENGINE = "engine";
const AUTO = "auto";

function draftOf(w: DlcWorkflow | null): Draft {
  return {
    key: w?.key ?? "",
    name: w?.name ?? "",
    description: w?.description ?? "",
    process: w?.process ?? "new-system",
    is_default: w?.is_default ?? false,
    enabled: w?.enabled ?? true,
    human: w?.human_mode ?? ENGINE,
    laneSel: w?.lane ?? AUTO,
  };
}

function bodyOf(d: Draft): DlcWorkflowCreate {
  const { human, laneSel, ...rest } = d;
  return {
    ...rest,
    human_mode: human === ENGINE ? null : (human as "ask" | "decide"),
    lane: laneSel === AUTO ? null : (laneSel as "trivial" | "small" | "full"),
  };
}

function errorText(err: unknown, t: ReturnType<typeof useTranslation>["t"]): string {
  if (err instanceof ApiError && err.code === "KEY_TAKEN") return t("dlcAdmin.error.keyTaken");
  if (err instanceof ApiError && err.code === "VERSION_CONFLICT")
    return t("dlcAdmin.error.conflict");
  return t("dlcAdmin.error.generic", { message: (err as Error).message });
}

function Preview({ process }: { process: DlcProcess }) {
  const { t } = useTranslation();
  const c = useDlcCatalog().data;
  if (c?.engine !== "ok") return null;
  return (
    <section className="flex flex-col gap-2">
      <p className="text-label font-medium">{t("dlcAdmin.preview")}</p>
      <StepFlow
        steps={stepsOf(c, process)}
        render={(s, i) => (
          <div className="h-full rounded-lg border border-border bg-muted/40 p-2 text-micro">
            <span className="font-semibold">
              {i + 1}. {s.title}
            </span>
          </div>
        )}
      />
    </section>
  );
}

type FieldProps = { id: string; label: string; children: React.ReactNode; hint?: string };
function Field({ id, label, children, hint }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-micro text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

type SetFn = <K extends keyof Draft>(k: K, v: Draft[K]) => void;

function TextFields({ d, set, editing }: { d: Draft; set: SetFn; editing: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <Field id="dlc-key" label={t("dlcAdmin.field.key")} hint={t("dlcAdmin.field.keyHint")}>
        <Input
          id="dlc-key"
          value={d.key}
          disabled={editing}
          onChange={(e) => set("key", e.target.value.trim().toLowerCase())}
          placeholder="quick-fix"
        />
      </Field>
      <Field id="dlc-name" label={t("dlcAdmin.field.name")}>
        <Input id="dlc-name" value={d.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className="sm:col-span-2">
        <Field id="dlc-desc" label={t("dlcAdmin.field.description")}>
          <Textarea
            id="dlc-desc"
            rows={2}
            value={d.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
      </div>
    </>
  );
}

function OptionFields({ d, set }: { d: Draft; set: SetFn }) {
  const { t } = useTranslation();
  return (
    <>
      <Field id="dlc-process" label={t("dlcAdmin.field.process")}>
        <Select value={d.process} onValueChange={(v) => set("process", v as DlcProcess)}>
          <SelectTrigger id="dlc-process">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DLC_PROCESSES.map((p) => (
              <SelectItem key={p} value={p}>
                {t(`dlcAdmin.process.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id="dlc-human" label={t("dlcAdmin.field.human")}>
        <Select value={d.human} onValueChange={(v) => set("human", v)}>
          <SelectTrigger id="dlc-human">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[ENGINE, "ask", "decide"].map((h) => (
              <SelectItem key={h} value={h}>
                {t(`dlcAdmin.human.${h as "engine" | "ask" | "decide"}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id="dlc-lane" label={t("dlcAdmin.field.lane")}>
        <Select value={d.laneSel} onValueChange={(v) => set("laneSel", v)}>
          <SelectTrigger id="dlc-lane">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[AUTO, "trivial", "small", "full"].map((l) => (
              <SelectItem key={l} value={l}>
                {t(`dlcAdmin.lane.${l as "auto" | "trivial" | "small" | "full"}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="flex items-end gap-6">
        <Label className="flex items-center gap-2">
          <Switch checked={d.is_default} onCheckedChange={(v) => set("is_default", v)} />
          {t("dlcAdmin.field.isDefault")}
        </Label>
        <Label className="flex items-center gap-2">
          <Switch checked={d.enabled} onCheckedChange={(v) => set("enabled", v)} />
          {t("dlcAdmin.field.enabled")}
        </Label>
      </div>
    </>
  );
}

type Props = { open: boolean; onOpenChange: (o: boolean) => void; workflow: DlcWorkflow | null };

export function DlcWorkflowDialog({ open, onOpenChange, workflow }: Props) {
  const { t } = useTranslation();
  const [d, setD] = useState<Draft>(() => draftOf(workflow));
  const create = useCreateDlcWorkflow();
  const patch = usePatchDlcWorkflow();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const pending = create.isPending || patch.isPending;
  const save = async () => {
    try {
      const body = bodyOf(d);
      if (workflow) {
        const { key: _k, ...rest } = body;
        await patch.mutateAsync({ id: workflow.id, patch: { ...rest, version: workflow.version } });
      } else await create.mutateAsync(body);
      toast.success(t("dlcAdmin.saved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(errorText(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t(workflow ? "dlcAdmin.dialogEdit" : "dlcAdmin.dialogNew")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextFields d={d} set={set} editing={!!workflow} />
          <OptionFields d={d} set={set} />
        </div>
        <Preview process={d.process} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("dlcAdmin.cancel")}
          </Button>
          <Button disabled={pending || !d.key || !d.name.trim()} onClick={() => void save()}>
            {t("dlcAdmin.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
