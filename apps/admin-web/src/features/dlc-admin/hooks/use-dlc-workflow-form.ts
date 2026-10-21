// DLC-R14 · form thêm / sửa flow AI SDLC: nháp (draft), map body, lưu (create/patch), map lỗi (KEY_TAKEN, VERSION_CONFLICT → câu riêng).
import type { DlcWorkflow, DlcWorkflowCreate } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@/lib/http";
import { useCreateDlcWorkflow, useDlcCatalog, usePatchDlcWorkflow } from "../api";

export type Draft = Omit<DlcWorkflowCreate, "human_mode" | "lane"> & {
  human: string;
  laneSel: string;
};

export const ENGINE = "engine";
export const AUTO = "auto";

export function draftOf(w: DlcWorkflow | null): Draft {
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

export function useDlcWorkflowForm(workflow: DlcWorkflow | null, onDone: () => void) {
  const { t } = useTranslation();
  const [d, setD] = useState<Draft>(() => draftOf(workflow));
  const create = useCreateDlcWorkflow();
  const patch = usePatchDlcWorkflow();
  const catalog = useDlcCatalog().data;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      const body = bodyOf(d);
      if (workflow) {
        const { key: _k, ...rest } = body;
        await patch.mutateAsync({ id: workflow.id, patch: { ...rest, version: workflow.version } });
      } else await create.mutateAsync(body);
      toast.success(t("dlcAdmin.saved"));
      onDone();
    } catch (err) {
      toast.error(errorText(err, t));
    }
  };
  return { d, set, save, catalog, pending: create.isPending || patch.isPending };
}
