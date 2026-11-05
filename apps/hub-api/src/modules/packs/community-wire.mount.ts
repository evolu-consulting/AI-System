// CR-102b · ADR-0031 · chỗ DUY NHẤT nối hai gói: dựng cổng `SupplierQuoteWriter` (usecase "Lưu báo giá" của contracts) và
// `HostBookReader` (cổng đọc sổ chủ quản) để tiêm vào community. Kiểu gán cho port của community ⇒ typecheck bắt lệch hợp đồng.
// Quyền ghi giá = việc `write` của gói contracts (nhóm được giao); user ngoài bị chặn ở usecase (`kind=external`).
import type { Db } from "@ai/db";
import type { Env, Hono } from "hono";
import type { Redis } from "ioredis";
import type { TenantLimitsOf } from "../../lib/ai-client/ai-client.env";
import type {
  CommunityBlobs,
  CompanyBrandReader,
  ContractsCapReader,
  HostBookReader,
  SupplierQuoteWriter,
} from "./community/application/pack-ports";
import { mountCommunity } from "./community/community.mount";
import { communityAgents, communityFlowPorts } from "./community-flow.mount";
import { communityUploadGate } from "./community-quota.mount";
import { productsRepo } from "./contracts/adapters/products.repo";
import { supplierQuoteRepo } from "./contracts/adapters/supplier-quote.repo";
import { saveQuoteUsecase } from "./contracts/application/save-quote.usecase";
import { companyBrandModule } from "./contracts/brand.mount";
import { hostBookModule } from "./contracts/host-book.mount";
import { supplierScores } from "./contracts/partners.mount";
import {
  createPackUow,
  orgForTenant,
  type PackAccessView,
  packAccessInput,
  packActionsFor,
} from "./kit/public";
import { fileboxClients, type PackFb } from "./packs.filebox";

const KEY = "contracts";

type CommunityLimitsOf = (
  tenantId: string,
) => Promise<
  (NonNullable<Awaited<ReturnType<TenantLimitsOf>>> & { uploads?: number | null }) | undefined
>;

export type CommunityPorts = {
  quotes: SupplierQuoteWriter;
  hostBook: HostBookReader;
  brand: CompanyBrandReader;
  caps: ContractsCapReader;
};

export function communityPorts(
  db: Db,
  view: PackAccessView,
  d: { timeZoneOf: (tenantId: string) => Promise<string>; now?: () => Date },
): CommunityPorts {
  const uow = createPackUow(db, KEY, (tx, t) => ({
    quotes: supplierQuoteRepo(tx, t),
    products: productsRepo(tx, t),
  }));
  const quotes = saveQuoteUsecase({
    uow,
    canWrite: async (who) =>
      packActionsFor(await packAccessInput(view, KEY, who)).includes("write"),
    timeZoneOf: d.timeZoneOf,
    ...(d.now ? { now: d.now } : {}),
  });
  const hostBook = hostBookModule(db, view, {
    reputation: supplierScores(db, { timeZoneOf: d.timeZoneOf }),
    timeZoneOf: d.timeZoneOf,
    ...(d.now ? { now: d.now } : {}),
  });
  // CR-110 · COM-FR-43: quyền đọc gói contracts từ cache cấu hình (0 SQL khi nóng); user ngoài không bao giờ có.
  const caps: ContractsCapReader = {
    contracts: async (who) =>
      who.userKind !== "external" &&
      packActionsFor(await packAccessInput(view, KEY, who)).includes("read"),
  };
  return { quotes, hostBook, brand: companyBrandModule(db), caps };
}

/** `packs.mount.ts` gọi: gắn `/pack/community/*` kèm hai cổng đã nối contracts. */
export function mountCommunityWired<E extends Env>(
  app: Hono<E>,
  prefix: string,
  db: Db,
  view: PackAccessView,
  timeZoneOf: (tenantId: string) => Promise<string>,
  o: {
    signal?: AbortSignal | undefined;
    worker?: boolean;
    fb?: PackFb | null;
    /** cr118-files-quota: bộ đếm lượt tải tệp (vắng ⇒ `/files` 503 `UPLOAD_QUOTA_UNAVAILABLE`, như contracts). */
    redis?: Redis | undefined;
    /** Trần riêng của tenant: `uploads` (tệp/ngày) + trần token AI (CR-120: agent `screen`/`triage`; vắng ⇒ không agent ⇒ duyệt tay). */
    limitsOf?: CommunityLimitsOf | undefined;
  } = {},
): void {
  const { fb, redis, limitsOf, ...rest } = o;
  const gate = communityUploadGate({
    redis,
    timeZoneOf,
    ...(limitsOf
      ? { tenantLimitOf: async (tid: string) => (await limitsOf(tid))?.uploads ?? null }
      : {}),
  });
  const agents = limitsOf ? communityAgents(db, limitsOf, redis) : undefined;
  mountCommunity(app, prefix, db, view, {
    ...rest,
    ...communityPorts(db, view, { timeZoneOf }),
    ...(fb ? { blobs: communityBlobs(fb) } : {}),
    gate,
    flows: communityFlowPorts(db, agents),
  });
}

/** CR-118 §11.1 · kho byte tệp bài trên FileBox org `t_<tenant>` (cùng client gói `packs.filebox.ts`). */
export function communityBlobs(fb: PackFb): CommunityBlobs {
  const client = fileboxClients(fb);
  return {
    put: async (tenantId, name, bytes) => client(orgForTenant(tenantId)).postFile(name, bytes),
    get: async (tenantId, fileId) => client(orgForTenant(tenantId)).getContent(fileId),
    drop: async (tenantId, fileId) => {
      await client(orgForTenant(tenantId)).deleteFile(fileId);
    },
  };
}
