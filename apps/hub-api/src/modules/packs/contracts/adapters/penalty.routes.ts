// CR-127 · X4 · spec §4.1: `POST /obligations/:id/penalty` (Ghi vào công nợ / Miễn phạt) · `GET /contracts/:id/penalties` (phạt ước tính + quyết định).
// Guard TRƯỚC đọc thân/tham số (viewer ghi ⇒ 403, 0 SQL); `:id` sai dạng ⇒ 400; thân strict; tenant khác / HĐ không thấy ⇒ 404 như không có.
import {
  PENALTY_ERRORS,
  PenaltyDecisionSchema,
  type PenaltyErrorCode,
} from "@ai/contracts/pack-contracts";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import {
  type PenaltyCommands,
  PenaltyFail,
  type PenaltyFailKind,
} from "../application/penalty.usecase";
import { execWho } from "./exec-errors";

const KEY = "contracts";
const uuid = (v: string | undefined) => parseWith(z.uuid(), v);

const CODE: Record<Exclude<PenaltyFailKind, "not_found">, PenaltyErrorCode> = {
  forbidden: "PENALTY_FORBIDDEN",
  decided: "PENALTY_DECIDED",
  not_applicable: "PENALTY_NOT_APPLICABLE",
  change_pending: "CHANGE_PENDING",
  over_cap: "PENALTY_OVER_CAP",
  evidence_required: "EVIDENCE_REQUIRED",
};
const MESSAGE: Record<PenaltyErrorCode, string> = {
  PENALTY_FORBIDDEN:
    "Chỉ người phụ trách, trưởng phòng của họ hoặc quản trị công ty được quyết định phạt của hợp đồng.",
  PENALTY_OVER_CAP:
    "Số tiền vượt mức trần phạt trong hợp đồng. Giảm số tiền xuống không quá mức trần.",
  CHANGE_PENDING: "Mốc đang có yêu cầu thay đổi chờ duyệt. Chờ duyệt xong rồi quyết định phạt.",
  PENALTY_DECIDED:
    "Mốc này đã được quyết định phạt (đã ghi vào công nợ hoặc đã chọn không tính phạt).",
  PENALTY_NOT_APPLICABLE: "Mốc chưa trễ hạn nên chưa có phạt để quyết định.",
  EVIDENCE_REQUIRED:
    "Cần ghi ý kiến (lý do) — bắt buộc khi không tính phạt, hoặc khi số tiền khác phạt ước tính / chưa có ước tính.",
};
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (!(e instanceof PenaltyFail)) throw e;
    if (e.kind === "not_found") throw appError("NOT_FOUND");
    const code = CODE[e.kind];
    throw new AppError(code, PENALTY_ERRORS[code], MESSAGE[code]);
  });

export function penaltyRoutes(view: PackAccessView, cmd: PenaltyCommands): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.post("/obligations/:id/penalty", packGuard(view, KEY, "write"), async (c) => {
    const id = uuid(c.req.param("id"));
    const b = parseWith(PenaltyDecisionSchema, await readJson(c));
    return c.json(await run(cmd.decide(await execWho(view, c), id, b)));
  });
  r.get("/contracts/:id/penalties", packGuard(view, KEY, "read"), async (c) => {
    const id = uuid(c.req.param("id"));
    const u = c.get("user");
    return c.json({ items: await run(cmd.list({ tenantId: u.tenantId, userId: u.userId }, id)) });
  });
  return r;
}
