// CR-118 · cr118-feature-gate-web · adapter HTTP: `GET /pack/me` (ETag/If-None-Match) + `/me/stream` sự kiện `config.changed`.
import {
  ME_STREAM_CONFIG_CHANGED,
  type ShellMeResponse,
  ShellMeResponseSchema,
} from "@ai/contracts/capabilities";
import { ApiError, apiResponse } from "@ai/web-kit/http";
import { listenFrames } from "~/platform/stream/me-stream";
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

/** CR-132 W1: dùng bộ phát `/me/stream` chung (một kết nối mỗi tab); chỉ lọc `config.changed`. */
export const listenConfigChanged: ConfigListener = (signal, onChanged, onReconnected) =>
  listenFrames([CONFIG_CHANGED_EVENT], signal, () => onChanged(), onReconnected);
