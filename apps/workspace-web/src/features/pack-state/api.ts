// PK-FR-05 · TF4 · `GET /pack/contracts/me` (hub-api qua proxy `/pack`, D-18) — Bearer + refresh 1 lần do web-kit lo.
import type { PackMeResponse } from "@ai/contracts";
import { api } from "@ai/web-kit/http";
import { PACK_KEY } from "./lib/pack-state";

export function fetchPackMe(signal?: AbortSignal): Promise<PackMeResponse> {
  return api<PackMeResponse>(`/pack/${PACK_KEY}/me`, { signal });
}
