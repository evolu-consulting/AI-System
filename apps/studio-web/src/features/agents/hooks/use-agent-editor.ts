// HUB-FR-60 · H4a-R03, R09, R12 · trạng thái editor: nháp, lỗi trường, dirty, lưu POST/PUT, xung đột 409 (ConflictDialog dùng chung).
// Tải bản mới = nạp `details.current` (bỏ nháp); Ghi đè = gửi lại NHÁP với `version = details.current.version` (sau xác nhận).
import type { Agent } from "@ai/contracts/studio";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConflict } from "#/components/shared/conflict/use-conflict";
import {
  type AgentDraft,
  type FieldErrors,
  fromAgent,
  hadBash,
  toPayload,
  validateDraft,
} from "../lib/draft";
import { diffDrafts } from "../lib/draft-diff";
import { classifySaveError } from "../lib/save-error";
import { useSaveAgent } from "./use-save-agent";

type Base = { draft: AgentDraft; version: number; hadBash: boolean };
type Opts = { initial: AgentDraft; agent?: Agent };

const baseOf = (d: AgentDraft, a?: Agent): Base => ({
  draft: d,
  version: a?.version ?? 0,
  hadBash: a ? hadBash(a) : false,
});

/** Nháp + bản gốc (để so dirty / version) + lỗi trường; `ref` luôn trỏ giá trị mới nhất cho callback bất đồng bộ. */
function useDraftState({ initial, agent }: Opts) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [base, setBase] = useState(() => baseOf(initial, agent));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [invalid, setInvalid] = useState(false);
  const ref = useRef({ draft, base });
  ref.current = { draft, base };
  const setFailure = (e: FieldErrors, inv: boolean) => {
    setErrors(e);
    setInvalid(inv);
  };
  const fail = (err: unknown) => {
    const f = classifySaveError(err);
    setFailure(f.errors, f.invalid);
    if (f.toast) toast.error(t(f.toast.key, f.toast.params));
  };
  const load = (a: Agent) => {
    const d = fromAgent(a);
    setDraft(d);
    setBase(baseOf(d, a));
    setFailure({}, false);
  };
  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return { draft, base, setBase, errors, invalid, ref, load, set, setFailure, fail };
}

export function useAgentEditor(opts: Opts) {
  const { agent } = opts;
  const { t } = useTranslation();
  const mode = agent ? "edit" : "new";
  const st = useDraftState(opts);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const mutation = useSaveAgent();

  const send = async (version?: number) => {
    const { draft: d, base: b } = st.ref.current;
    const payload = toPayload(d, mode === "edit" ? (version ?? b.version) : undefined);
    const res = await mutation.mutateAsync({ id: agent?.id, payload });
    st.setFailure({}, false);
    if (agent) st.load(res.agent);
    else {
      st.setBase(baseOf(d));
      setCreatedId(res.agent.id);
    }
    return res;
  };
  const conflict = useConflict<Agent>({
    buildRows: (cur) => diffDrafts(st.ref.current.draft, fromAgent(cur), (k) => t(k)),
    submit: (v) => send(v),
    onReload: st.load,
    onError: st.fail,
  });
  const save = async () => {
    const v = validateDraft(st.draft, { mode, hadBash: st.base.hadBash });
    st.setFailure(v.errors, v.unmapped > 0);
    if (v.unmapped > 0 || Object.keys(v.errors).length > 0) return;
    try {
      await send();
    } catch (err) {
      if (!conflict.capture(err, st.base.version)) st.fail(err);
    }
  };

  const dirty = createdId === null && JSON.stringify(st.draft) !== JSON.stringify(st.base.draft);
  const hadBash = st.base.hadBash;
  return {
    ...st,
    mode,
    save,
    saving: mutation.isPending,
    createdId,
    hadBash,
    dirty,
    conflictProps: conflict.props,
  } as const;
}
