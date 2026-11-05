// CR-118 · cr118-feature-gate-web · adapter HTTP: `GET /pack/me` (ETag/If-None-Match) + `/me/stream` sự kiện `config.changed`.
import {
  ME_STREAM_CONFIG_CHANGED,
  type ShellMeResponse,
  ShellMeResponseSchema,
} from "@ai/contracts";
import { createSseParser } from "@ai/contracts/chat";
import { ApiError, apiResponse } from "@ai/web-kit/http";
import type { ConfigListener, PackMeFetch } from "../lib/pack-me-source";

export const PACK_ME_PATH = "/pack/me";
/** = `ME_STREAM_CONFIG_CHANGED` (`@ai/contracts` capabilities). Không import giá trị từ gốc contracts: kéo cả zod schema vào bundle đầu. */
export const CONFIG_CHANGED_EVENT = "config.changed";

/** Kiểm hình tối thiểu thay cho zod (ngân sách bundle); server kiểm schema `ShellMeResponseSchema`. */
export function parsePackMe(raw: unknown): ShellMeResponse {
  const o = raw as Partial<ShellMeResponse> | null;
  if (!o || typeof o.flags !== "object" || o.flags === null || !Array.isArray(o.apps)) {
    throw new Error("Phản hồi /pack/me sai hình");
  }
  return o as ShellMeResponse;
}

export const fetchPackMe: PackMeFetch = async (etag, signal) => {
  let res: Response;
  try {
    res = await apiResponse(PACK_ME_PATH, {
      signal,
      headers: etag ? { "If-None-Match": etag } : undefined,
    });
  } catch (err) {
    // web-kit coi mọi non-2xx là lỗi ⇒ 304 đến đây dưới dạng ApiError(304).
    if (err instanceof ApiError && err.status === 304) return { status: "not-modified" };
    throw err;
  }
  const data: ShellMeResponse = parsePackMe(await res.json());
  return { status: "fresh", data, etag: res.headers.get("ETag") };
};

const FIRST_MS = 1000;
const CAP_MS = 30_000;
export const reconnectDelay = (n: number): number => Math.min(FIRST_MS * 2 ** n, CAP_MS);
/** 4xx (trừ 408/429) = nối lại vô ích ⇒ dừng; dự phòng focus/403 lo phần còn lại. */
export const isFatal = (err: unknown): boolean =>
  err instanceof ApiError &&
  err.status >= 400 &&
  err.status < 500 &&
  err.status !== 408 &&
  err.status !== 429;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

async function readOnce(signal: AbortSignal, onOpen: () => void, onChanged: () => void) {
  const res = await apiResponse("/me/stream", { headers: { Accept: "text/event-stream" }, signal });
  if (!res.body) throw new ApiError(res.status, "HTTP_ERROR", "Empty event stream");
  onOpen();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const feed = createSseParser((raw) => {
    if (raw.event === CONFIG_CHANGED_EVENT) onChanged();
  });
  signal.addEventListener("abort", () => void reader.cancel().catch(() => {}), { once: true });
  for (;;) {
    const { done, value } = await reader.read();
    if (done || signal.aborted) return;
    feed(decoder.decode(value, { stream: true }));
  }
}

export const listenConfigChanged: ConfigListener = async (signal, onChanged, onReconnected) => {
  let failures = 0;
  let wasOpen = false;
  while (!signal.aborted) {
    try {
      await readOnce(
        signal,
        () => {
          if (wasOpen) onReconnected();
          wasOpen = true;
          failures = 0;
        },
        onChanged,
      );
    } catch (err) {
      if (isFatal(err)) return;
    }
    if (signal.aborted) return;
    await sleep(reconnectDelay(failures++), signal);
  }
};
