// HUB-FR-44 · hàng đợi upload của một composer: chip theo thứ tự chọn, ≤ 3 đồng thời, 429 chờ `Retry-After` rồi thử 1 lần.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "~/lib/http";
import { uploadAttachment } from "../api";
import { type Chip, nextToStart, uploadFailure } from "../lib/queue";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

async function uploadOnce429(file: File, signal: AbortSignal) {
  try {
    return await uploadAttachment(file, signal);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 429) throw err;
    await sleep((err.retryAfter ?? 1) * 1000, signal);
    return uploadAttachment(file, signal);
  }
}

const failureOf = (err: unknown) =>
  err instanceof ApiError
    ? uploadFailure(err)
    : { errorKey: "attach.err.failed" as const, retryable: true };

type Patch = (uid: number, p: Partial<Chip>) => void;

function runUpload(chip: Chip, aborts: Map<number, AbortController>, patch: Patch) {
  const ac = new AbortController();
  aborts.set(chip.uid, ac);
  uploadOnce429(chip.file, ac.signal)
    .then((att) => patch(chip.uid, { status: "ready", id: att.id }))
    .catch((err: unknown) => {
      if (!ac.signal.aborted) patch(chip.uid, { status: "error", ...failureOf(err) });
    })
    .finally(() => aborts.delete(chip.uid));
}

export function useAttachQueue() {
  const [chips, setChips] = useState<Chip[]>([]);
  const nextUid = useRef(0);
  const aborts = useRef(new Map<number, AbortController>());
  const patch = useCallback((uid: number, p: Partial<Chip>) => {
    setChips((cs) => cs.map((c) => (c.uid === uid ? { ...c, ...p } : c)));
  }, []);

  useEffect(() => {
    const start = nextToStart(chips);
    if (start.length === 0) return;
    setChips((cs) => cs.map((c) => (start.includes(c.uid) ? { ...c, status: "uploading" } : c)));
    for (const chip of chips.filter((c) => start.includes(c.uid))) {
      runUpload(chip, aborts.current, patch);
    }
  }, [chips, patch]);

  useEffect(() => {
    const map = aborts.current;
    return () => {
      for (const ac of map.values()) ac.abort();
    };
  }, []);

  /** Thêm chip: `queued` (hợp lệ) hoặc `error` (bị chặn sớm). */
  const push = useCallback((entries: Pick<Chip, "file" | "status" | "errorKey">[]) => {
    setChips((cs) => [...cs, ...entries.map((e) => ({ ...e, uid: nextUid.current++ }))]);
  }, []);
  const remove = useCallback((uid: number) => {
    aborts.current.get(uid)?.abort();
    setChips((cs) => cs.filter((c) => c.uid !== uid));
  }, []);
  const retry = useCallback(
    (uid: number) => patch(uid, { status: "queued", errorKey: undefined, retryable: false }),
    [patch],
  );
  const clear = useCallback(() => setChips([]), []);
  return { chips, setChips, push, remove, retry, clear };
}
