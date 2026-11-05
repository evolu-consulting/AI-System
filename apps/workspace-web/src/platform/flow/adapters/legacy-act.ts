// CR-120 · ADR-0036 §5 · rollback `HUB_FLOW_RUNTIME=off`: route `/pack/<k>/flow/*` không gắn ⇒ `act` của adapter HTTP đi endpoint
// cũ của gói (hub giữ MỘT bản phát hành). Chỉ file này biết đường cũ; CR-121 xoá cả file. Thân `FlowActionRequest` ⇒ thân cũ.
import type { FlowActionRequest } from "@ai/contracts/flow";
import { ApiError, api } from "@ai/web-kit/http";
import type { LegacyActDone } from "../port";

const enc = encodeURIComponent;

type Legacy = (
  ref: string,
  action: string,
  req: FlowActionRequest,
) => { path: string; body: object };

/** Khe ⇒ endpoint cũ. `contracts.approval`: `POST /pack/contracts/contracts/:id/approval {action, feedback?, products?}`. */
const LEGACY: Record<string, Legacy> = {
  "contracts.approval": (ref, action, req) => ({
    path: `/pack/contracts/contracts/${enc(ref)}/approval`,
    body: {
      action,
      ...(req.feedback ? { feedback: req.feedback } : {}),
      ...(req.extension !== undefined ? { products: req.extension } : {}),
    },
  }),
};

export async function legacyAct(
  slot: string,
  ref: string,
  action: string,
  req: FlowActionRequest,
): Promise<LegacyActDone> {
  const to = LEGACY[slot];
  if (!to) throw new ApiError(404, "HTTP_ERROR", `No legacy action endpoint for ${slot}`);
  const { path, body } = to(ref, action, req);
  const out = await api<{ step?: string | null } | null>(path, { method: "POST", body });
  return { view: null, phase: out?.step ?? null };
}
