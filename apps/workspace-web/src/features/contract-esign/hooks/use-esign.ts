// cf-esign-docusign · trạng thái + thao tác ký số của một HĐ (một lần làm mới khi quay về từ trang ký, không poll nền).
import type { ESignSignerIn, ESignStateOut } from "@ai/contracts/pack-contracts";
import { ApiError } from "@ai/web-kit/http";
import { toast } from "@ai/web-kit/ui/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listenProcessEvents } from "~/features/contract-approval/stream/process-stream";
import {
  esignKey,
  fetchEsign,
  refreshEsign,
  sendEsign,
  signedLink,
  signUrl,
  voidEsign,
} from "../api";
import { ESIGN_QUERY_OPTS, eventConcernsEsign } from "../lib/esign-push";
import { esignErrKey, returnedFromSigning, signReturnUrl } from "../lib/esign-view";

export function useEsign(id: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: esignKey(id),
    queryFn: ({ signal }) => fetchEsign(id, signal),
    // CR-125 · x6 · không poll (Luật 4c): hub đẩy `esign.updated` qua `/me/stream`; dự phòng duy nhất = tải lại khi quay lại cửa sổ.
    ...ESIGN_QUERY_OPTS,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const msgOf = (e: unknown) => t(esignErrKey(e instanceof ApiError ? e.code : null));

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

  // CR-125 · x6 · nghe `/me/stream`: phong bì của HĐ này đổi ⇒ tải lại trạng thái (vài trăm ms). Nối lại sau đứt ⇒ tải lại một lần.
  useEffect(() => {
    const ac = new AbortController();
    const reload = () => void qc.invalidateQueries({ queryKey: esignKey(id) });
    void listenProcessEvents(
      ac.signal,
      (e) => {
        if (eventConcernsEsign(e, id)) reload();
      },
      reload,
    );
    return () => ac.abort();
  }, [id, qc]);

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
    send: (s: ESignSignerIn[], provider?: string) =>
      run(() => sendEsign(id, s, provider), t("contracts.esign.sent")),
    cancel: (reason: string) => run(() => voidEsign(id, reason)),
    signNow: (provider?: string) =>
      run(async () => {
        const back = signReturnUrl(window.location.origin, id);
        const { url } = await signUrl(id, back, provider);
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
