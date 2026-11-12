// HD-FR-08 · D-06 · D-16 · D-17 · HD1 plan §4–§5: nối tải lên hợp đồng (lớp 4 của gói): `PackUow` (role `contracts_rw`) + bộ
// đếm Redis (vắng ⇒ 503 `UPLOAD_QUOTA_UNAVAILABLE`) + FileBox org `t_<tenant>` + `DocxConverter` (N1 T5g) + `ExtractionStarter`
// (HD2: hàng đợi trích của `extraction.mount.ts`). `packs.mount.ts` gắn dưới `/pack/contracts` cạnh `contractsModule` (T7).
import {
  CONTRACT_UPLOAD_GLOBAL_DAILY,
  CONTRACT_UPLOAD_MAX_BYTES,
  CONTRACT_UPLOAD_TENANT_DAILY,
} from "@ai/contracts/pack-contracts";
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import type { Redis } from "ioredis";
import { logger } from "../../../lib/logger";
import type { PackAccessView, PackFileboxClient, PackGuardVars, PackWho } from "../kit/public";
import { createDocxConverter, createPackUow, packTenantOnly } from "../kit/public";
import { contractFlowRepo } from "./adapters/contract-flow.repo";
import { promoteRepo } from "./adapters/deals.repo";
import { officeText } from "./adapters/office-text";
import { pdfPageCounter } from "./adapters/pdf-pages";
import { scanLimits } from "./adapters/source-file-text";
import { uploadRoutes } from "./adapters/upload.routes";
import { uploadContractRepo } from "./adapters/upload-contract.repo";
import { redisUploadCounter, unavailableUploadCounter } from "./adapters/upload-counter.redis";
import { zipNames } from "./adapters/zip-names";
import { createPromoteContract } from "./application/promote-contract.usecase";
import type { ContractFileStore, ExtractionStarter } from "./application/upload-contract.ports";
import { createUploadContract, takeQuota } from "./application/upload-contract.usecase";
import { uploadDay } from "./domain/upload.rules";
import { contractFlowGate } from "./flow-events.mount";

const KEY = "contracts";
const MiB = 1024 * 1024;

export type UploadMountDeps = {
  db: Db;
  view: PackAccessView;
  redis?: Redis;
  /** Client FileBox theo org (mỗi lời gọi một org `t_<tenant>`). */
  filebox: (org: string) => PackFileboxClient;
  timeZoneOf: (tenantId: string) => Promise<string>;
  /** tenant-quotas · lượt tải/ngày riêng của tenant (Admin); null ⇒ env `CONTRACTS_UPLOADS_TENANT_DAY`. */
  tenantLimitOf?: (tenantId: string) => Promise<number | null>;
  /** HD2 · hàng đợi trích (`contractsAiModule`); gọi SAU commit, không chặn tải lên. */
  starter: ExtractionStarter;
  /** CR-101 DOC-deals-fix: nâng giao dịch khi tenant bật duyệt ⇒ mở lượt duyệt cấp 1 (engine/máy, như nhập tay). */
};

/** Env số nguyên dương, sai/vắng ⇒ mặc định (plan §5: `CONTRACTS_MAX_MB`, `CONTRACTS_UPLOADS_*_DAY`). */
const envInt = (k: string, def: number): number => {
  const n = Number(process.env[k]);
  return Number.isInteger(n) && n > 0 ? n : def;
};

/** `CONTRACTS_MAX_MB` kẹp ≤ 20 MiB: trên mức này CHECK `files.size_bytes` và `DOCX_MAX_INPUT` từ chối ⇒ 5xx (review m-14). */
export function contractsMaxBytes(): number {
  const cap = CONTRACT_UPLOAD_MAX_BYTES / MiB;
  return Math.min(envInt("CONTRACTS_MAX_MB", cap), cap) * MiB;
}

function fileStore(client: (org: string) => PackFileboxClient): ContractFileStore {
  return {
    put: (org, name, bytes) => client(org).postFile(name, bytes),
    remove: async (org, fileId) => {
      await client(org).deleteFile(fileId);
    },
  };
}

/** Bộ đếm + hạn mức tải lên/ngày (dùng chung: tải lên, nâng giao dịch, tạo HĐ từ bước quy trình). */
function quotaDeps(d: UploadMountDeps) {
  return {
    counter: d.redis ? redisUploadCounter(d.redis) : unavailableUploadCounter,
    limits: {
      tenant: envInt("CONTRACTS_UPLOADS_TENANT_DAY", CONTRACT_UPLOAD_TENANT_DAILY),
      global: envInt("CONTRACTS_UPLOADS_GLOBAL_DAY", CONTRACT_UPLOAD_GLOBAL_DAILY),
    },
    ...(d.tenantLimitOf ? { tenantLimitOf: d.tenantLimitOf } : {}),
  };
}

/**
 * Use case tải lên DUY NHẤT của gói. `flow: false` (cr125-contract-from-step) ⇒ không phát `contract.uploaded`: HĐ tạo từ bước của một
 * quy trình đang chạy không được mở thêm một quy trình tiếp nhận khác. Mặc định như route tải lên.
 */
export function uploadContractFor(d: UploadMountDeps, o: { flow?: boolean } = {}) {
  const uow = packTenantOnly(
    createPackUow(d.db, KEY, (tx, tid) => ({
      upload: uploadContractRepo(tx, tid),
      contractFlow: contractFlowRepo(tx, tid), // CR-122 A1
    })),
  );
  return createUploadContract({
    uow,
    ...quotaDeps(d),
    files: fileStore(d.filebox),
    docx: createDocxConverter(),
    officeText, // CR-122 p9: xlsx/pptx/odt ⇒ chữ
    starter: d.starter,
    zipNames,
    pdfPages: pdfPageCounter(scanLimits().maxPages), // CR-122 p9: quá trần trang ⇒ 422 FILE_TOO_MANY_PAGES
    newId: () => Bun.randomUUIDv7(),
    log: logger,
    ...(o.flow === false ? {} : { flow: contractFlowGate(d.db) }), // CR-122 A1
  });
}

export function uploadModule(d: UploadMountDeps): Hono<PackGuardVars> {
  const q = quotaDeps(d);
  const upload = uploadContractFor(d);
  const maxBytes = contractsMaxBytes();
  // CR-101 DOC-deals · R10: nâng giao dịch thành HĐ (file ký + số), cùng kho tệp + kiểm loại tệp với tải lên.
  const promote = createPromoteContract({
    uow: packTenantOnly(createPackUow(d.db, KEY, (tx, tid) => ({ promote: promoteRepo(tx, tid) }))),
    files: fileStore(d.filebox),
    zipNames,
    newId: () => Bun.randomUUIDv7(),
    // Cùng hạn mức tải lên/ngày (trừ trước FileBox, hoàn khi không nâng được).
    quota: async (who, timeZone) => {
      const at = new Date();
      const days = { tenant: uploadDay(at, timeZone), global: uploadDay(at, "UTC") };
      await takeQuota(q, { who, timeZone }, days, at);
      return () => q.counter.refund(who.tenantId, days);
    },
  });
  return uploadRoutes(d.view, { upload, promote, maxBytes, timeZoneOf: d.timeZoneOf });
}
