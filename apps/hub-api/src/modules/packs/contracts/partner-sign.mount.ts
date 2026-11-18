// CR-182 · đợt 2 · nối «Đối tác ký qua link» (lớp lắp ráp): `PackUow` role `contracts_rw` + FileBox. Gắn dưới `/pack/contracts`:
//   POST /contracts/:id/partner-sign/resend   — «Gửi lại link ký»: người tải lên HĐ hoặc quản trị (thu hồi link cũ, tạo link mới, gửi lại)
//   GET  /contracts/:id/partner-sign          — trạng thái link mới nhất (đã gửi lúc, mở lúc, hạn, đã ký / từ chối + lý do)
// Đăng ký cổng công khai `partnerSignPort` (hub `partners/adapters/partner-sign.routes.ts` gọi) + nghe NOTIFY «Bên A ký đủ, còn chỗ Bên B» (không poll).
// Thông báo/chuỗi `counts`/`complete` do lớp lắp ráp `packs.sign-doc.ts` tiêm (gói không import module hub).
import type { Db } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../lib/errors";
import { parseWith } from "../../../lib/http";
import { logger } from "../../../lib/logger";
import {
  checkPackAccess,
  createPackUow,
  orgForTenant,
  type PackAccessView,
  type PackFileboxClient,
  type PackGuardVars,
  packAccessInput,
  packGuard,
  partnerSignMailer,
  partnerSignPort,
} from "../kit/public";
import { contractFilesRepo } from "./adapters/contract-files.repo";
import { partnerSignRepo } from "./adapters/partner-sign.repo";
import { signDocRepo } from "./adapters/sign-doc.repo";
import { signDocsRepo } from "./adapters/sign-docs.repo";
import { signFieldsRepo } from "./adapters/sign-fields.repo";
import { PARTNER_SIGN_START_CHANNEL } from "./adapters/sign-flow.engine";
import { sha256Hex, stampPdf } from "./adapters/sign-stamp.pdf";
import { signVersionsRepo } from "./adapters/sign-versions.repo";
import type { PartnerCounts } from "./application/partner-sign.deps";
import {
  PartnerSignFail,
  type PartnerSignUsecases,
  partnerSignUsecases,
} from "./application/partner-sign.usecase";
import { signFlowHooks } from "./application/sign-flow.hooks";
import { noDigitalSigner, produceSigned } from "./domain/digital-signer";
import { contractsMaxBytes } from "./upload.mount";

export type PartnerSignPorts = {
  /** Bước Ký `ondoc` đang mở của HĐ: Bên A đủ chưa + số chỗ Bên B (null = không có bước Ký đang mở). */
  counts: (tenantId: string, contractId: string) => Promise<PartnerCounts>;
  /** Thả bước chờ `esign.completed` (HĐ «Đã ký»). */
  complete: (tenantId: string, contractId: string) => Promise<void>;
};

const NIL = "00000000-0000-0000-0000-000000000000";

function httpOf(e: PartnerSignFail): AppError {
  switch (e.kind) {
    case "not_found":
      return appError("NOT_FOUND");
    case "forbidden":
      return new AppError(
        "PACK_FORBIDDEN",
        403,
        "Chỉ người tải lên hoặc quản trị mới gửi lại link ký",
      );
    case "no_contact":
      return new AppError("PARTNER_CONTACT_MISSING", 409, "Đối tác chưa có liên hệ nào có email");
    case "not_needed":
      return new AppError("PARTNER_SIGN_NOT_NEEDED", 409, "Hợp đồng chưa tới lượt đối tác ký");
  }
}
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    throw e instanceof PartnerSignFail ? httpOf(e) : e;
  });

export function partnerSignModule(
  db: Db,
  view: PackAccessView,
  filebox: (org: string) => PackFileboxClient,
  ports: PartnerSignPorts,
  o: { worker?: boolean | undefined; signal?: AbortSignal | undefined } = {},
): Hono<PackGuardVars> {
  const uow = createPackUow(db, "contracts", (tx, t) => ({
    contractFiles: contractFilesRepo(tx, t),
    signDoc: signDocRepo(tx, t),
    docs: signDocsRepo(tx, t),
    fields: signFieldsRepo(tx, t),
    versions: signVersionsRepo(tx, t),
    partnerSign: partnerSignRepo(tx, t),
  }));
  const uc: PartnerSignUsecases = partnerSignUsecases({
    uow: uow as never,
    // Tx không gắn tenant: chỉ để gọi hàm DEFINER theo BĂM token (không đọc bảng nào khác).
    lookup: (fn) =>
      withPackScope(db, { packKey: "contracts", tenantId: NIL, userId: null }, (tx) =>
        fn(partnerSignRepo(tx, NIL)),
      ),
    files: {
      read: (org, boxId, max) => filebox(org).getContent(boxId, max),
      put: (org, name, bytes) => filebox(org).postFile(name, bytes),
      remove: async (org, fileId) => {
        await filebox(org).deleteFile(fileId);
      },
    },
    maxBytes: contractsMaxBytes(),
    produce: (i) =>
      produceSigned({
        pdf: i.pdf,
        marks: i.marks,
        ink: i.ink,
        kind: i.kind,
        signer: noDigitalSigner,
        stamp: stampPdf,
        sha256: sha256Hex,
        ctx: { tenantId: i.who.tenantId, userId: i.who.userId },
      }),
    mailer: () => partnerSignMailer.get(),
    baseUrl: () => partnerSignMailer.baseUrl(),
    logLink: () => partnerSignMailer.logLink(),
    counts: ports.counts,
    complete: ports.complete,
    log: logger,
    newId: () => Bun.randomUUIDv7(),
    now: () => new Date(),
    orgOf: orgForTenant,
  });

  partnerSignPort.set({
    view: (th, x) => uc.view(th, x),
    content: (th, f, v) => uc.content(th, f, v),
    quick: (th, b) => uc.quick(th, b),
    sign: (th, b) => uc.sign(th, b),
    decline: (th, b) => uc.decline(th, b),
  });
  // Lắp ráp ⇒ bên A ký đủ (đường Lưu) mời đối tác; không ném.
  signFlowHooks.partnerStart = async (tenantId, contractId, by) => {
    await uc.ensureLink(tenantId, contractId, { by, force: false }).catch((e: unknown) =>
      logger.warn("partner-sign-start-failed", {
        contract_id: contractId,
        error: e instanceof Error ? e.name : "unknown",
      }),
    );
  };
  if (o.worker) listenStart(db, ports, uc, o.signal);

  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, "contracts", "read");
  const who = (c: { get(k: "user"): { tenantId: string; userId: string } }) => {
    const u = c.get("user");
    return { tenantId: u.tenantId, userId: u.userId };
  };
  const id = (c: { req: { param(k: string): string | undefined } }) =>
    parseWith(z.uuid(), c.req.param("id"));
  r.post("/contracts/:id/partner-sign/resend", read, async (c) => {
    const i = await packAccessInput(view, "contracts", c.get("user"));
    const admin =
      c.get("user").role === "tenant_admin" ||
      checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
    return c.json(await run(uc.resend(who(c), id(c), admin)), 201);
  });
  r.get("/contracts/:id/partner-sign", read, async (c) => {
    const out = await run(uc.status(who(c), id(c)));
    if (!out) throw appError("NOT_FOUND");
    c.header("cache-control", "no-store");
    return c.json(out);
  });
  return r;
}

/** Nghe NOTIFY của `signWaitReady` (Q8: bên A đã ký đủ từ bước duyệt, tới bước Ký thì còn chỗ Bên B): mời đối tác ký. Nhiều instance ⇒ khoá advisory theo HĐ. */
function listenStart(
  db: Db,
  ports: PartnerSignPorts,
  uc: PartnerSignUsecases,
  signal?: AbortSignal,
) {
  void db
    .listen(PARTNER_SIGN_START_CHANNEL, (payload) => {
      try {
        const p = JSON.parse(payload) as { t?: string; c?: string };
        if (!p.t || !p.c) return;
        const [t, c] = [p.t, p.c];
        void ports
          .counts(t, c)
          .then((n) =>
            n?.a_done && n.b_open > 0 ? uc.ensureLink(t, c, { by: null, force: false }) : undefined,
          )
          .catch((e: unknown) =>
            logger.warn("partner-sign-listen-failed", {
              error: e instanceof Error ? e.name : "unknown",
            }),
          );
      } catch {
        /* payload lạ: bỏ */
      }
    })
    .then((off) => signal?.addEventListener("abort", () => void off(), { once: true }))
    .catch((e: unknown) =>
      logger.warn("partner-sign-listen-failed", { error: e instanceof Error ? e.name : "unknown" }),
    );
}
