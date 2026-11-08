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
import { esignErrKey, shouldRefreshOnReturn, signReturnUrl } from "../lib/esign-view";

/** Cờ "vừa rời trang đi ký" theo HĐ (sessionStorage; hỏng/vắng ⇒ coi như không có — vẫn còn tham số `?esign=return`). */
const awayKey = (id: string) => `esign-away:${id}`;
const away = {
  has: (id: string): boolean => {
    try {
      return window.sessionStorage.getItem(awayKey(id)) !== null;
    } catch {
      return false;
    }
  },
  set: (id: string) => {
    try {
      window.sessionStorage.setItem(awayKey(id), "1");
    } catch {
      /* không có kho ⇒ chỉ dựa vào tham số URL */
    }
  },
  clear: (id: string) => {
    try {
      window.sessionStorage.removeItem(awayKey(id));
    } catch {
      /* bỏ qua */
    }
  },
};

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
  /** Lần cuối hỏi nhà cung cấp thành công (ISO) — hiện cạnh nút "Cập nhật trạng thái ký". */
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
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

  /** Một lần hỏi hub làm mới phong bì từ nhà cung cấp (idempotent); thành công ⇒ ghi mốc kiểm tra. */
  const refresh = async (): Promise<boolean> => {
    const ok = await run(() => refreshEsign(id));
    if (ok) setCheckedAt(new Date().toISOString());
    return ok;
  };

  // Quay về từ trang ký (DocuSign / ký thử) ⇒ làm mới MỘT lần rồi bỏ tham số + cờ khỏi URL/phiên.
  const once = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chạy một lần theo HĐ (`refresh` đổi mỗi render, có cờ `once`)
  useEffect(() => {
    if (once.current || !shouldRefreshOnReturn(window.location.search, away.has(id))) return;
    once.current = true;
    away.clear(id);
    const u = new URL(window.location.href);
    u.searchParams.delete("esign");
    u.searchParams.delete("event");
    window.history.replaceState(null, "", u.toString());
    void refresh();
  }, [id]);

  // Nút Back từ trang ký (trang khôi phục từ bộ nhớ đệm, không chạy lại effect) ⇒ cùng một lần làm mới.
  // biome-ignore lint/correctness/useExhaustiveDependencies: gắn một lần theo HĐ
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted && away.has(id)) {
        away.clear(id);
        void refresh();
      }
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [id]);

  return {
    q,
    busy,
    err,
    checkedAt,
    refresh,
    clearErr: () => setErr(null),
    send: (s: ESignSignerIn[], provider?: string) =>
      run(() => sendEsign(id, s, provider), t("contracts.esign.sent")),
    cancel: (reason: string) => run(() => voidEsign(id, reason)),
    signNow: (provider?: string) =>
      run(async () => {
        const back = signReturnUrl(window.location.origin, id);
        const { url } = await signUrl(id, back, provider);
        away.set(id);
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
