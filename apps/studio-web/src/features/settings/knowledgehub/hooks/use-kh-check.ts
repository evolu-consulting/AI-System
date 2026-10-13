// HUB-FR-131 · D3 · "Kiểm tra": mở Dialog ngay, gọi POST check (hạn UI 25 s), làm mới hàng khi xong.
import type { KhCheckResult } from "@ai/contracts/hub-admin";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { checkKhConnection, KH_KEY } from "../api";

export const CHECK_TIMEOUT_MS = 25_000;
export type CheckState =
  | { id: string; name: string; phase: "running" }
  | { id: string; name: string; phase: "done"; result: KhCheckResult }
  | { id: string; name: string; phase: "error"; code: string };

export function useKhCheck() {
  const qc = useQueryClient();
  const [state, setState] = useState<CheckState | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const start = useCallback(
    async (c: { id: string; name: string }) => {
      ctl.current?.abort();
      const mine = new AbortController();
      ctl.current = mine;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        mine.abort();
      }, CHECK_TIMEOUT_MS);
      const set = (s: CheckState) => (!mine.signal.aborted || timedOut ? setState(s) : undefined);
      setState({ id: c.id, name: c.name, phase: "running" });
      try {
        const result = await checkKhConnection({ id: c.id, signal: mine.signal });
        set({ id: c.id, name: c.name, phase: "done", result });
      } catch (err) {
        const code = timedOut ? "TIMEOUT" : String((err as { code?: unknown } | null)?.code ?? "");
        set({ id: c.id, name: c.name, phase: "error", code });
      } finally {
        clearTimeout(timer);
        void qc.invalidateQueries({ queryKey: KH_KEY });
      }
    },
    [qc],
  );
  const close = useCallback(() => {
    ctl.current?.abort();
    setState(null);
  }, []);
  return { state, start, close };
}
