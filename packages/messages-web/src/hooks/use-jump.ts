// CR-178 · M3 · nhảy tới một tin trong khung chat: tin đã có ⇒ chỉ cuộn + nháy; chưa có ⇒ nạp trang `around_seq` thay danh sách tin, rồi cuộn xuống tải tin mới hơn (`has_newer`).
import type { Message } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchMessages, msgKeys } from "../api";
import { errorKey } from "../lib/errors";
import { maxSeq, prependNewer, resetAround } from "../lib/find";
import type { MsgPages } from "../lib/message-pages";
import { useJumpRequest } from "./jump-request";

type Data = MsgPages & { pageParams: unknown[] };

export function useJump(id: string, items: readonly Message[]) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [focus, setFocus] = useState<{ seq: number; nonce: number } | null>(null);
  const [hasNewer, setHasNewer] = useState(false);
  const nonce = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const busy = useRef(false);
  const jump = useCallback(
    async (seq: number) => {
      if (!itemsRef.current.some((m) => m.seq === seq)) {
        try {
          const page = await fetchMessages(id, null, undefined, seq);
          await qc.cancelQueries({ queryKey: msgKeys.msgs(id) });
          qc.setQueryData<MsgPages>(msgKeys.msgs(id), resetAround(page, seq));
          setHasNewer(page.has_newer === true);
        } catch (e) {
          toast(t(errorKey(e)), "late");
          return;
        }
      }
      setFocus({ seq, nonce: ++nonce.current });
    },
    [id, qc, t],
  );
  const loadNewer = useCallback(async () => {
    if (busy.current) return;
    const from = maxSeq(itemsRef.current);
    if (!from) return;
    busy.current = true;
    try {
      const page = await fetchMessages(id, null, undefined, from);
      qc.setQueryData<MsgPages>(msgKeys.msgs(id), (old) =>
        prependNewer(old as Data | undefined, page, from),
      );
      setHasNewer(page.has_newer === true);
    } catch {
      // thử lại ở lần cuộn kế
    } finally {
      busy.current = false;
    }
  }, [id, qc]);
  // Yêu cầu từ danh sách (kết quả tìm): mỗi yêu cầu xử lý đúng một lần.
  const req = useJumpRequest();
  const handled = useRef(0);
  useEffect(() => {
    if (!req || req.id !== id || req.n === handled.current) return;
    handled.current = req.n;
    void jump(req.seq);
  }, [req, id, jump]);
  return { focus, hasNewer, jump, loadNewer };
}
