// HUB-FR-62 · H4a-R07, R09 · trạng thái form Orchestrator dùng cho form mặc định và Sheet: nháp, validate, lưu, 409 (ConflictDialog).
import type { Orchestrator } from "@ai/contracts/studio";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConflict } from "#/components/shared/conflict/use-conflict";
import { diffOrch } from "../lib/diff";
import { fromOrch, type OrchDraft, type OrchErrors, sameDraft, validateDraft } from "../lib/draft";
import { classifySaveError } from "../lib/save-error";
import type { SaveVars } from "./use-orch-mutations";

type Cfg = {
  /** Giá trị gốc của form (bản đang lưu, hoặc bản mặc định khi thêm mới). */
  source: OrchDraft;
  version: number;
  tenantId?: string;
  create?: boolean;
  save: (v: SaveVars) => Promise<unknown>;
  reload: () => void;
  onSaved?: () => void;
  /** id agent → nhãn hiển thị cho "Xem khác biệt". */
  agentName: (id: string) => string;
};

/** Bản gốc đổi (lưu xong / tải lại): nháp đang đồng bộ với bản cũ thì theo bản mới; đang sửa dở thì giữ. */
function useFollowSource(source: OrchDraft, draft: OrchDraft, setDraft: (d: OrchDraft) => void) {
  const prev = useRef(source);
  useEffect(() => {
    if (sameDraft(prev.current, source)) return;
    if (sameDraft(draft, prev.current)) setDraft(source);
    prev.current = source;
  }, [source, draft, setDraft]);
}

export function useOrchEditor(cfg: Cfg) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(cfg.source);
  const [errors, setErrors] = useState<OrchErrors>({});
  const [saving, setSaving] = useState(false);
  const dirty = !sameDraft(draft, cfg.source);
  useFollowSource(cfg.source, draft, setDraft);

  const send = async (version: number) => {
    const { input } = validateDraft(draft);
    if (!input) throw new Error("invalid");
    await cfg.save({ input, version, tenantId: cfg.tenantId, create: cfg.create });
    cfg.onSaved?.();
  };
  const fail = (err: unknown) => {
    const f = classifySaveError(err);
    setErrors(f.errors);
    if (f.toast) toast.error(t(f.toast.key, f.toast.params));
  };
  const show = (k: keyof OrchDraft, v: string) => {
    if (k === "agentId") return cfg.agentName(v);
    return k === "onNoMatch" ? t(`orch.noMatch.${v}`) : v;
  };
  const conflict = useConflict<Orchestrator>({
    buildRows: (cur) => diffOrch(draft, fromOrch(cur), (k) => t(k), show),
    submit: send,
    onReload: (cur) => {
      setDraft(fromOrch(cur));
      cfg.reload();
    },
    onError: fail,
  });

  const submit = async () => {
    const { input, errors: e } = validateDraft(draft);
    setErrors(e);
    if (!input) return;
    setSaving(true);
    try {
      await send(cfg.version);
    } catch (err) {
      if (!conflict.capture(err, cfg.version)) fail(err);
    } finally {
      setSaving(false);
    }
  };
  const set = <K extends keyof OrchDraft>(k: K, v: OrchDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  return { draft, set, errors, setErrors, dirty, saving, submit, conflict: conflict.props };
}
