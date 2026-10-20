// HD-FR-91…96 · BR-3 · BR-4 · HD9 plan §1: route `/pack/contracts/cks/**`. Guard quyền gói TRƯỚC đọc thân/tham số (viewer gửi
// POST ⇒ 403, 0 SQL); `:id` sai dạng ⇒ 400; tenant/người làm chỉ từ token; thân strict (khoá lạ như `tenant_id` ⇒ 400).
// `CksFail` ⇒ mã lỗi contract (`CKS_ERRORS`); tenant khác ⇒ 404 như không có.
import {
  CKS_ERRORS,
  CksCertCreateSchema,
  CksCompleteSchema,
  CksCustomersQuerySchema,
  CksFollowupSchema,
  CksLostSchema,
  CksLotCreateSchema,
  CksPricesQuerySchema,
  CksRenewSchema,
  CksSaleCreateSchema,
  CksScanSchema,
  CksSignedDocsQuerySchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AppError, appError } from "../../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../../kit/adapters/pack-guard.middleware";
import { CksFail, type CksReads } from "../application/read.usecase";
import type { CksRenewals } from "../application/renewal.usecase";
import type { CksSales } from "../application/sale.usecase";
import type { CksUpload } from "../application/signed.usecase";
import { cksWriteGuard } from "./cks-read-only";
import { signedUploadRoute } from "./signed.routes";

const KEY = "contracts";
const JSON_MAX = 256 * 1024;

export type CksRoutesDeps = {
  reads: CksReads;
  sales: CksSales;
  renewals: CksRenewals;
  upload: CksUpload;
  /** V2-H (Q4): tenant còn được ghi CKS? Không ⇒ route ghi 410 `CKS_READ_ONLY`. */
  writable: (tenantId: string) => Promise<boolean>;
};

const FAIL: Record<CksFail["kind"], keyof typeof CKS_ERRORS | "NOT_FOUND"> = {
  not_found: "NOT_FOUND",
  stock: "CKS_STOCK",
  serial: "CKS_SERIAL_TAKEN",
  renewal_open: "CKS_RENEWAL_OPEN",
  renewal_closed: "CKS_RENEWAL_CLOSED",
  dates: "CKS_DATES",
};
const MESSAGES: Record<keyof typeof CKS_ERRORS, string> = {
  CKS_STOCK: "Lô không còn đủ chữ ký trong kho",
  CKS_SERIAL_TAKEN: "Serial bị trùng (nhập hai lần, hoặc đã có trong app)",
  CKS_RENEWAL_OPEN: "Nhóm này đang được gia hạn",
  CKS_RENEWAL_CLOSED: "Lần gia hạn này đã đóng",
  CKS_DATES: "Ngày hết hạn phải sau ngày ký",
};

/** Lỗi luật ⇒ AppError; lỗi khác ném lại. */
export function cksError(e: unknown): never {
  if (!(e instanceof CksFail)) throw e;
  const code = FAIL[e.kind];
  if (code === "NOT_FOUND") throw appError("NOT_FOUND");
  throw new AppError(code, CKS_ERRORS[code], MESSAGES[code]);
}
const run = <T>(p: Promise<T>): Promise<T> => p.catch(cksError);
const whoOf = (u: { tenantId: string; userId: string }) => ({
  tenantId: u.tenantId,
  userId: u.userId,
});
const id = (v: string | undefined) => parseWith(z.uuid(), v);
const tooLarge = () => new AppError("PAYLOAD_TOO_LARGE", 413, "Payload too large");

export function cksRoutes(view: PackAccessView, d: CksRoutesDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = cksWriteGuard(packGuard(view, KEY, "write"), d.writable);
  const small = bodyLimit({ maxSize: JSON_MAX, onError: () => Promise.reject(tooLarge()) });
  const body = async <S extends z.ZodType>(c: Context, s: S) => parseWith(s, await readJson(c));

  r.get("/cks/overview", read, async (c) => c.json(await d.reads.overview(whoOf(c.get("user")))));
  r.get("/cks/customers", read, async (c) =>
    c.json(await d.reads.customers(whoOf(c.get("user")), parseQuery(c, CksCustomersQuerySchema))),
  );
  r.get("/cks/customers/:id", read, async (c) => {
    const one = await d.reads.customer(whoOf(c.get("user")), id(c.req.param("id")));
    if (!one) throw appError("NOT_FOUND");
    return c.json(one);
  });
  r.get("/cks/lots", read, async (c) => c.json(await d.reads.lots(whoOf(c.get("user")))));
  r.get("/cks/prices", read, async (c) =>
    c.json(await d.reads.prices(whoOf(c.get("user")), parseQuery(c, CksPricesQuerySchema).filter)),
  );
  r.get("/cks/signed-docs", read, async (c) =>
    c.json(await d.reads.signedDocs(whoOf(c.get("user")), parseQuery(c, CksSignedDocsQuerySchema))),
  );
  // D9-10: "Dò giá" cần cầu run agent (N2) — chưa có lượt dò nào; dò mới ⇒ 503 sau guard + validate.
  r.get("/cks/scans", read, (c) => c.json([]));
  r.post("/cks/scans", write, small, async (c) => {
    await body(c, CksScanSchema);
    throw new AppError("AGENT_UNAVAILABLE", 503, "Price scan agent not configured");
  });

  r.post("/cks/lots", write, small, async (c) =>
    c.json(
      await run(d.sales.createLot(whoOf(c.get("user")), await body(c, CksLotCreateSchema))),
      201,
    ),
  );
  r.post("/cks/sales", write, small, async (c) =>
    c.json(await run(d.sales.sell(whoOf(c.get("user")), await body(c, CksSaleCreateSchema))), 201),
  );
  r.post("/cks/certificates", write, small, async (c) =>
    c.json(
      await run(d.sales.addCertificate(whoOf(c.get("user")), await body(c, CksCertCreateSchema))),
      201,
    ),
  );
  r.post("/cks/groups/:id/renew", write, small, async (c) => {
    const sale = id(c.req.param("id"));
    const b = await body(c, CksRenewSchema);
    const out = d.renewals.renew(whoOf(c.get("user")), sale, {
      price_each: b.price_each ?? null,
      years: b.years,
      remind_at: b.remind_at ?? null,
    });
    return c.json(await run(out), 201);
  });
  r.post("/cks/renewals/:id/complete", write, small, async (c) => {
    const rid = id(c.req.param("id"));
    const b = await body(c, CksCompleteSchema);
    const out = d.renewals.complete(whoOf(c.get("user")), rid, {
      serials: b.serials,
      valid_to: b.valid_to ?? null,
    });
    return c.json(await run(out));
  });
  r.post("/cks/renewals/:id/lost", write, small, async (c) => {
    const rid = id(c.req.param("id"));
    const b = await body(c, CksLostSchema);
    return c.json(await run(d.renewals.lose(whoOf(c.get("user")), rid, b.reason)));
  });
  r.post("/cks/customers/:id/followups", write, small, async (c) => {
    const cid = id(c.req.param("id"));
    const b = await body(c, CksFollowupSchema);
    return c.json(await run(d.renewals.followup(whoOf(c.get("user")), cid, b)), 201);
  });
  signedUploadRoute(r, write, d.upload);
  return r;
}
