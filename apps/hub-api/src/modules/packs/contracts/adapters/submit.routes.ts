// CR-127 K3 · spec §4.1: `POST /contracts/:id/submit` · `/withdraw` · `/recreate`. Guard `write` TRƯỚC đọc thân; `:id` sai ⇒ 400; thân strict;
// tenant khác / không thấy ⇒ 404; vai sai ⇒ 403. Mã lỗi + HTTP theo `SUBMIT_ERRORS` (tasks §9).
import {
  RecreateRequestSchema,
  SUBMIT_ERRORS,
  type SubmitErrorCode,
  SubmitRequestSchema,
  WithdrawRequestSchema,
} from "@ai/contracts/pack-contracts";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import type {
  recreateContract,
  submitContract,
  submitPreview,
  withdrawContract,
} from "../application/submit.usecase";

const MSG: Record<SubmitErrorCode, string> = {
  CONTRACT_NOT_DRAFT: "Chỉ gửi được hợp đồng ở DRAFT.",
  EXTRACT_NOT_READY: "AI chưa đọc xong hợp đồng — chờ hoặc bấm Đọc lại.",
  STATE_CONFLICT: "Hợp đồng vừa đổi trạng thái. Tải lại trang rồi thử lại.",
  UNCHANGED_REASON_REQUIRED: "Bạn chưa đổi gì so với lần trước — ghi lý do gửi lại.",
  FILE_REQUIRED: "Tải văn bản hợp đồng lên trước khi gửi.",
  WITHDRAW_NOT_ALLOWED: "Không rút về được.",
  CONTRACT_NOT_REJECTED: "Chỉ tạo lại từ hợp đồng bị từ chối.",
  NO_APPROVAL_FLOW: "Công ty chưa có quy trình duyệt hợp đồng — nhờ quản trị soạn ở mục Quy trình.",
};
function fail(code: string, details?: Record<string, unknown>): never {
  if (code === "not_found") throw appError("NOT_FOUND");
  if (code === "forbidden") throw appError("FORBIDDEN");
  const k = code as SubmitErrorCode;
  throw new AppError(k, SUBMIT_ERRORS[k], MSG[k], details);
}
const whoOf = (u: { tenantId: string; userId: string }) => ({
  tenantId: u.tenantId,
  userId: u.userId,
});

export function submitRoutes(
  view: PackAccessView,
  d: {
    submit: ReturnType<typeof submitContract>;
    withdraw: ReturnType<typeof withdrawContract>;
    recreate: ReturnType<typeof recreateContract>;
    /** CR-127 · M4 · vắng ⇒ 404. */
    preview?: ReturnType<typeof submitPreview>;
  },
) {
  const r = new Hono<PackGuardVars>();
  const write = packGuard(view, "contracts", "write");
  r.post("/contracts/:id/submit", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const b = parseWith(SubmitRequestSchema, await readJson(c));
    const out = await d.submit(whoOf(c.get("user")), id, {
      unchangedReason: b.unchanged_reason,
      evidence: b.evidence,
    });
    if ("error" in out) fail(out.error);
    return c.json(out);
  });
  // CR-127 · M4 · các bước HĐ sẽ đi qua nếu Gửi bây giờ (quyền như Gửi: guard `write` + người tạo ∪ phụ trách). Chỉ đọc.
  r.get("/contracts/:id/submit-preview", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const out = await d.preview?.(whoOf(c.get("user")), id);
    if (!out) throw appError("NOT_FOUND");
    if ("error" in out) fail(out.error);
    return c.json({
      flow_name: out.flowName,
      steps: out.steps.map((x) => ({
        kind: x.kind,
        label: x.label,
        who_label: x.whoLabel,
        ...(x.dueH !== undefined ? { due_h: x.dueH } : {}),
      })),
      ...(out.block ? { block: out.block } : {}),
    });
  });
  r.post("/contracts/:id/withdraw", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const b = parseWith(WithdrawRequestSchema, await readJson(c));
    const out = await d.withdraw(whoOf(c.get("user")), id, b.reason);
    if ("error" in out) {
      if (out.error === "WITHDRAW_NOT_ALLOWED")
        fail(out.error, { why: out.why, by: out.by ?? null, step: out.step ?? null });
      fail(out.error);
    }
    return c.json(out);
  });
  r.post("/contracts/:id/recreate", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    parseWith(RecreateRequestSchema, await readJson(c));
    const out = await d.recreate(whoOf(c.get("user")), id);
    if ("error" in out) fail(out.error);
    return c.json(out, 201);
  });
  return r;
}
