// HUB-FR-66 · AC-H4b2-02 · D3 · "Kiểm tra key"/"Kiểm tra lại": mở hộp ngay, một request đồng bộ (server ≤ 10 s; UI chặn
// 15 s), không polling. 404/READONLY/NOT_CONFIGURED ⇒ đóng hộp + toast. Chỉ giữ kết quả đã che key, không bao giờ giữ key.
import type { ProviderCheckResult } from "@ai/contracts/studio";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { checkProvider, PROVIDERS_KEY } from "../api";
import { failureAction, type Msg } from "../lib/check-text";

export const CHECK_UI_TIMEOUT_MS = 15_000;
export type CheckTarget = { id: string; key: string; kind: string };
type Base = { target: CheckTarget; sub: boolean };
export type CheckState =
  | (Base & { phase: "running" })
  | (Base & { phase: "done"; result: ProviderCheckResult })
  | (Base & { phase: "error"; msg: Msg });
const codeOf = (e: unknown) => String((e as { code?: unknown } | null)?.code ?? "");

type Outcome = { ok: true; result: ProviderCheckResult } | { ok: false; code: string };

async function runCheck(id: string, ac: AbortController): Promise<Outcome> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, CHECK_UI_TIMEOUT_MS);
  try {
    return { ok: true, result: await checkProvider({ id, signal: ac.signal }) };
  } catch (err) {
    return { ok: false, code: timedOut ? "TIMEOUT" : codeOf(err) };
  } finally {
    clearTimeout(timer);
  }
}

export function useCheckProvider() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [state, setState] = useState<CheckState | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const fail = useCallback(
    (base: Base, code: string) => {
      if (code === "TIMEOUT")
        return setState({ ...base, phase: "error", msg: { key: "models.check.timeout" } });
      const a = failureAction(code);
      if (a.reload) void qc.invalidateQueries({ queryKey: PROVIDERS_KEY });
      if (!a.close) return setState({ ...base, phase: "error", msg: a.msg });
      ctl.current = null;
      setState(null);
      toast.error(t(a.msg.key, a.msg.params));
    },
    [qc, t],
  );

  const start = useCallback(
    async (p: CheckTarget) => {
      ctl.current?.abort();
      const mine = new AbortController();
      ctl.current = mine;
      const base: Base = { target: { id: p.id, key: p.key, kind: p.kind }, sub: p.kind !== "api" };
      setState({ ...base, phase: "running" });
      const out = await runCheck(p.id, mine);
      if (ctl.current !== mine) return;
      if (out.ok) setState({ ...base, phase: "done", result: out.result });
      else fail(base, out.code);
    },
    [fail],
  );

  const close = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    setState(null);
  }, []);

  return { state, start, close };
}
