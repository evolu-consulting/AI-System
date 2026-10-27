// Gap #9 · hàng đợi tải lên nhiều tệp: mỗi tệp một lượt `POST /contracts` (mỗi tệp tạo HĐ + lượt đọc riêng như trước). Tuần tự (bộ
// chuyển DOCX của máy chủ xếp hàng công bằng theo tenant ⇒ song song cùng tenant sẽ bị BUSY); lỗi một tệp không dừng cả lô.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadContract } from "../api";
import type { UploadMeta } from "../lib/upload-meta";
import { checkFile, type UploadItem } from "../lib/upload-queue";
import { type QuotaNotice, quotaNotice, stopOnQuota } from "../lib/upload-quota";
import { uploadErrorText } from "../list-upload-error";

const QUOTA = Symbol("quota");
const CHECK_KEY = { type: "badType", size: "tooLarge", empty: "empty" } as const;
type Job = { key: number; file: File; meta?: UploadMeta };

/** Trạng thái + vòng chạy tuần tự: hàng đợi `queue`, tệp giữ lại để thử lại `files`, `pump` chạy tới khi hết việc. */
function useUploadRunner(onSingleDone: (id: string) => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const files = useRef(new Map<number, { file: File; meta?: UploadMeta }>());
  const queue = useRef<Job[]>([]);
  const running = useRef(false);
  const [quota, setQuota] = useState<QuotaNotice | null>(null);
  const quotaShown = useRef(false);
  const patch = useCallback((key: number, p: Partial<UploadItem>) => {
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...p } : i)));
  }, []);

  /** Một tệp: lên máy chủ, ghi trạng thái; trả mã HĐ khi xong. */
  const uploadOne = useCallback(
    async (job: Job): Promise<string | null | typeof QUOTA> => {
      patch(job.key, { state: "uploading" });
      try {
        const r = await uploadContract(job.file, job.meta);
        patch(job.key, { state: "done", id: r.id });
        files.current.delete(job.key);
        return r.id;
      } catch (e) {
        const q = quotaNotice(e);
        if (q) {
          // Hết lượt: dừng cả hàng đợi (tệp còn lại báo cùng câu), popup một lần mỗi lô.
          queue.current = [];
          const text = uploadErrorText(e, t);
          setItems((all) => stopOnQuota(all, job.key, text));
          if (!quotaShown.current) setQuota(q);
          quotaShown.current = true;
          return QUOTA;
        }
        patch(job.key, { state: "error", error: uploadErrorText(e, t), retryable: true });
        return null;
      }
    },
    [patch, t],
  );

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const ids: string[] = [];
    let total = 0;
    try {
      for (let job = queue.current.shift(); job; job = queue.current.shift()) {
        total++;
        const id = await uploadOne(job);
        if (typeof id === "string") ids.push(id); // QUOTA đã xoá hàng đợi ⇒ vòng tự dừng
      }
    } finally {
      running.current = false;
    }
    if (ids.length) void qc.invalidateQueries({ queryKey: ["contracts"] });
    // Một tệp duy nhất và thành công ⇒ mở thẳng màn kiểm như trước.
    if (total === 1 && ids[0]) onSingleDone(ids[0]);
  }, [onSingleDone, qc, uploadOne]);
  return { items, setItems, files, queue, running, patch, pump, t, quota, setQuota, quotaShown };
}

export function useUploadQueue(onSingleDone: (id: string) => void) {
  const { items, setItems, files, queue, running, patch, pump, t, quota, setQuota, quotaShown } =
    useUploadRunner(onSingleDone);
  const seq = useRef(0);

  const enqueue = useCallback(
    (list: File[], meta?: UploadMeta) => {
      if (!list.length) return;
      const fresh: UploadItem[] = list.map((f) => {
        const key = ++seq.current;
        const bad = checkFile(f);
        const base = { key, name: f.name, size: f.size };
        if (bad !== "ok")
          return { ...base, state: "error", error: t(`contracts.list.upload.${CHECK_KEY[bad]}`) };
        files.current.set(key, { file: f, ...(meta ? { meta } : {}) });
        queue.current.push({ key, file: f, ...(meta ? { meta } : {}) });
        return { ...base, state: "queued" };
      });
      // Lô mới khi đang rảnh thay danh sách cũ (và cho phép popup hết lượt hiện lại); đang chạy ⇒ nối thêm.
      if (!running.current) quotaShown.current = false;
      setItems((all) => (running.current ? [...all, ...fresh] : fresh));
      void pump();
    },
    [pump, t, files, queue, running, setItems, quotaShown],
  );

  const retry = useCallback(
    (key: number) => {
      const kept = files.current.get(key);
      if (!kept) return;
      queue.current.push({ key, ...kept });
      patch(key, { state: "queued", retryable: false });
      void pump();
    },
    [patch, pump, files, queue],
  );
  return {
    items,
    enqueue,
    retry,
    clear: () => setItems([]),
    quota,
    dismissQuota: () => setQuota(null),
  };
}
