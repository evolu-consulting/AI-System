// CR-101 DOC-deals · route Giao dịch là chứng từ dưới `/pack/contracts` (quyền: `read` GET, `write` còn lại; người xem ⇒ 403 trước
// khi đọc thân; tenant khác / không thấy ⇒ 404):
//   POST /contracts/deals            tạo giao dịch (lưu là có hiệu lực, mốc mặc định; `settled_now` xác nhận ngay — Câu 4)
//   GET  /open-milestones             (CR-127 X2) mốc mở của HĐ còn hiệu lực của đối tác — ô "Thuộc hợp đồng nào"
//   GET  /contracts/:id/edit-log     lịch sử sửa (máy ghi, X2)
//   GET  /transactions, /transactions/:id   lớp tương thích ĐỌC (G2 cũ) — map chứng từ `deal`
//   POST|PATCH|DELETE /transactions*        410 `USE_CONTRACTS` (bảng G1 chỉ đọc)
// Sửa trực tiếp = `PATCH /contracts/:id` sẵn có (giao dịch không khoá); nâng = `POST /contracts/:id/promote` (upload.routes); xoá =
// `DELETE /contracts/:id` (V2-M, chỉ owner, đảo kho).
import {
  DEAL_ERRORS,
  DealCreateRequestSchema,
  type DealCreateResponse,
  type DealLinkedResponse,
  EDIT_LOG_MAX,
  type OpenMilestone,
  OpenMilestonesQuerySchema,
  TransactionListQuerySchema,
} from "@ai/contracts/pack-contracts";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import type { PackWho } from "../../kit/public";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import type { CreateManual } from "../application/create-manual.usecase";
import { DealLinkFail, type DealLinkIn } from "../application/link-deal.usecase";
import { type DealMilestone, settleNowOrder } from "../domain/deal.rules";
import type { ManualInput } from "../domain/manual.rules";
import { MANUAL_BODY_MAX_BYTES, productFail } from "./extraction.routes";
import { ledgerError } from "./ledger.routes";

const KEY = "contracts";

export type DealsRoutesDeps = {
  create: CreateManual;
  /** CR-127 X2 · gắn giao dịch vào mốc HĐ (spec §4.1). */
  link: {
    check(who: PackWho, input: ManualInput, link: DealLinkIn | undefined): Promise<void>;
    to(
      who: PackWho,
      input: ManualInput,
      obligationId: string,
      evidence:
        | {
            note: string;
            signature_attachment_id?: string | undefined;
            attachment_ids?: string[] | undefined;
          }
        | undefined,
    ): Promise<DealLinkedResponse>;
  };
  openMilestones(
    who: PackWho,
    q: z.infer<typeof OpenMilestonesQuerySchema>,
  ): Promise<OpenMilestone[]>;
  settle(who: PackWho, milestoneId: string): Promise<unknown>;
  milestones(who: PackWho, id: string): Promise<DealMilestone[]>;
  editLog(who: PackWho, id: string, limit: number): Promise<unknown[] | null>;
  legacyList(who: PackWho, q: z.infer<typeof TransactionListQuerySchema>): Promise<unknown>;
  legacyDetail(who: PackWho, id: string): Promise<unknown | null>;
};

const who = (c: Context<PackGuardVars>): PackWho => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const idOf = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("id"));
const gone = () => {
  throw new AppError(
    "USE_CONTRACTS",
    DEAL_ERRORS.USE_CONTRACTS,
    "Giao dịch đã chuyển vào chứng từ — dùng /contracts",
  );
};
const errCode = (e: unknown): string => {
  const o = e as { code?: unknown; kind?: unknown; name?: unknown };
  return String(o?.code ?? o?.kind ?? o?.name ?? "SETTLE_FAILED");
};

/** CR-127 X2 · tasks §9: câu VI của đường gắn mốc; lỗi sổ/kho của `recordFulfillment` đi qua `ledgerError` (OVER_PLAN, CONTRACT_ON_HOLD…). */
function linkError(e: unknown): never {
  if (!(e instanceof DealLinkFail)) return ledgerError(e);
  const T = {
    link_required: [
      "LINK_REQUIRED",
      DEAL_ERRORS.LINK_REQUIRED,
      'Đối tác có hợp đồng còn hiệu lực chứa sản phẩm này — chọn hợp đồng hoặc "Không theo hợp đồng".',
    ],
    reason_required: [
      "LINK_REASON_REQUIRED",
      DEAL_ERRORS.LINK_REASON_REQUIRED,
      "Ghi lý do không theo hợp đồng.",
    ],
    mixed: [
      "LINK_MIXED",
      DEAL_ERRORS.LINK_MIXED,
      "Một giao dịch chỉ ghi vào một mốc; tách dòng sản phẩm ngoài hợp đồng thành giao dịch khác.",
    ],
    evidence_required: [
      "EVIDENCE_REQUIRED",
      DEAL_ERRORS.EVIDENCE_REQUIRED,
      "Cần ý kiến và chữ ký hoặc ít nhất một tệp.",
    ],
    claimed: [
      "TASK_CLAIMED",
      DEAL_ERRORS.TASK_CLAIMED,
      "Mốc đang do người khác xử lý — nhờ họ xác nhận hoặc chọn Không theo hợp đồng.",
    ],
  } as const;
  if (e.kind === "not_found") throw appError("NOT_FOUND");
  const [code, status, msg] = T[e.kind];
  throw new AppError(code, status, msg, e.kind === "claimed" ? { by: e.by } : undefined);
}

/** Câu 4: xác nhận lần lượt mốc mặc định (≤ 3, giao trước); dừng ở mốc lỗi đầu tiên (giao dịch đã lưu, mốc còn lại để mở). */
async function settleNow(d: DealsRoutesDeps, w: PackWho, id: string) {
  const settled: string[] = [];
  for (const mid of settleNowOrder(await d.milestones(w, id))) {
    try {
      await d.settle(w, mid);
      settled.push(mid);
    } catch (e) {
      return { settled, settle_error: errCode(e) };
    }
  }
  return { settled, settle_error: null };
}

export function dealsRoutes(view: PackAccessView, d: DealsRoutesDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  const limit = bodyLimit({
    maxSize: MANUAL_BODY_MAX_BYTES,
    onError: () => Promise.reject(new AppError("PAYLOAD_TOO_LARGE", 413, "Payload too large")),
  });
  r.post("/contracts/deals", write, limit, async (c) => {
    const { source, settled_now, link, evidence, ...input } = parseWith(
      DealCreateRequestSchema,
      await readJson(c),
    );
    const w = who(c);
    if (link && "obligation_id" in link) {
      // CR-127 X2 · BR-50: chọn HĐ ⇒ KHÔNG tạo chứng từ giao dịch — ghi thẳng vào mốc (hoặc chờ duyệt khi có quy trình).
      const done = await d.link
        .to(w, input as ManualInput, link.obligation_id, evidence)
        .catch(linkError);
      return c.json(done, done.state === "pending" ? 202 : 201);
    }
    await d.link.check(w, input as ManualInput, link).catch(linkError);
    const unlinkedReason = link?.none.reason.trim();
    const out = await d
      .create(w, input as ManualInput, { source, ...(unlinkedReason ? { unlinkedReason } : {}) })
      .catch(productFail);
    const s = settled_now ? await settleNow(d, w, out.id) : { settled: [], settle_error: null };
    const body: DealCreateResponse = {
      state: "posted",
      deal_id: out.id,
      id: out.id,
      doc_type: "deal",
      status: "done",
      version: out.version,
      ...s,
    };
    return c.json(body, 201);
  });
  r.get("/open-milestones", read, async (c) =>
    c.json(await d.openMilestones(who(c), parseQuery(c, OpenMilestonesQuerySchema))),
  );
  r.get("/contracts/:id/edit-log", read, async (c) => {
    const items = await d.editLog(who(c), idOf(c), EDIT_LOG_MAX);
    if (items === null) throw appError("NOT_FOUND");
    return c.json({ items });
  });
  r.get("/transactions", read, async (c) =>
    c.json(await d.legacyList(who(c), parseWith(TransactionListQuerySchema, c.req.query()))),
  );
  r.get("/transactions/:id", read, async (c) => {
    const x = await d.legacyDetail(who(c), idOf(c));
    if (x === null) throw appError("NOT_FOUND");
    return c.json(x);
  });
  r.post("/transactions", write, gone);
  r.on(
    ["POST", "PATCH", "PUT", "DELETE"],
    ["/transactions/:id", "/transactions/:id/*"],
    write,
    gone,
  );
  return r;
}
