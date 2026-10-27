// cf-esign-docusign · trạng thái + thao tác ký số của một HĐ (một lần làm mới khi quay về từ trang ký, không poll nền).
import type { ESignSignerIn, ESignStateOut } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import {
  esignKey,
  fetchEsign,
  refreshEsign,
  sendEsign,
  signedLink,
  signUrl,
  voidEsign,
} from "../api";
import { returnedFromSigning } from "../lib/esign-view";

const ERR = new Set(["ESIGN_DISABLED", "ESIGN_STATE", "ESIGN_UNSUPPORTED_FILE", "ESIGN_PROVIDER"]);

export function useEsign(id: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: esignKey(id),
    queryFn: ({ signal }) => fetchEsign(id, signal),
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const msgOf = (e: unknown) =>
    t(
      `contracts.esign.err.${e instanceof ApiError && e.code && ERR.has(e.code) ? e.code : "unknown"}`,
    );

  const run = async (
    fn: () => Promise<ESignStateOut | undefined>,
    done?: string,
  ): Promise<boolean> => {
    setBusy(true);
    setErr(null);
    try {
      const s = await fn();
      if (s) qc.setQueryData(esignKey(id), s);
      if (done) toast(done);
      return true;
    } catch (e) {
      setErr(msgOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Quay về từ trang ký (DocuSign / ký thử) ⇒ làm mới MỘT lần rồi bỏ tham số khỏi URL.
  const once = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chạy một lần theo HĐ (`run` đổi mỗi render, có cờ `once`)
  useEffect(() => {
    if (once.current || !returnedFromSigning(window.location.search)) return;
    once.current = true;
    const u = new URL(window.location.href);
    u.searchParams.delete("esign");
    u.searchParams.delete("event");
    window.history.replaceState(null, "", u.toString());
    void run(() => refreshEsign(id));
  }, [id]);

  return {
    q,
    busy,
    err,
    clearErr: () => setErr(null),
    send: (s: ESignSignerIn[]) => run(() => sendEsign(id, s), t("contracts.esign.sent")),
    refresh: () => run(() => refreshEsign(id)),
    cancel: (reason: string) => run(() => voidEsign(id, reason)),
    signNow: () =>
      run(async () => {
        const back = `${window.location.origin}/contracts/${encodeURIComponent(id)}`;
        const { url } = await signUrl(id, back);
        window.location.assign(url);
        return undefined;
      }),
    download: () =>
      run(async () => {
        const { url } = await signedLink(id);
        window.open(url, "_blank", "noopener");
        return undefined;
      }),
  };
}
