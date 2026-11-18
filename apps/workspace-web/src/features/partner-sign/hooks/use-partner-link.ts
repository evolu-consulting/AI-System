// CR-182 · cổng hook cho component (component-no-fetch): xem link, tạo chữ ký nhanh, ký một tệp, từ chối. Mọi gọi API đi qua `PartnerSignPort`.
import type { PartnerQuickMethod, PartnerSignBody } from "@ai/contracts/pack-contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { partnerSignPort } from "../api";
import { blobToBase64, blueDataUrl, recallImage, rememberImage } from "../lib/quick-image";
import type { PartnerSignPort } from "../ports";

export const linkKey = (token: string) => ["psign", token] as const;

export function usePartnerLink(token: string, injected?: PartnerSignPort) {
  const qc = useQueryClient();
  const port = useMemo(() => injected ?? partnerSignPort(token), [injected, token]);
  // GET đặt lại cookie CSRF và tính vào hạn mức mở link ⇒ không tự tải lại khi đổi tab.
  const view = useQuery({
    queryKey: linkKey(token),
    queryFn: ({ signal }) => port.view(signal),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    void recallImage(token).then((u) => {
      if (!off && u) setImage(u);
    });
    return () => {
      off = true;
    };
  }, [token]);
  const csrf = view.data?.csrf ?? "";
  const refresh = () => qc.invalidateQueries({ queryKey: linkKey(token) });

  const quick = useMutation({
    mutationFn: async (v: { method: PartnerQuickMethod; png: Blob }) => {
      await port.quickSignature(csrf, v.method, await blobToBase64(v.png));
      const url = await blueDataUrl(v.png);
      await rememberImage(token, url);
      setImage(url);
    },
    onSuccess: refresh,
  });
  const sign = useMutation({
    mutationFn: (body: PartnerSignBody) => port.sign(csrf, body),
  });
  const decline = useMutation({
    mutationFn: (reason: string) => port.decline(csrf, reason),
    onSuccess: refresh,
  });
  return { port, view, image, quick, sign, decline, refresh };
}
