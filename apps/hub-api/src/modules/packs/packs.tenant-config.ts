// Tra cấu hình tenant cho module gói từ `ConfigCache` (0 SQL khi nóng) + đọc env số nguyên — tách khỏi `packs.mount.ts`.

import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AttachmentStorage } from "../attachments/public";
import { attachmentBytesOf, evidenceFileBytesOf, evidenceFileNamesOf } from "../attachments/public";
import type { ConfigCache } from "../config/public";
import { DEFAULT_TENANT_TZ } from "../config/public";

export type WithConfig = { config: ConfigCache };

/** BR-6 (HD9) · múi giờ tenant; vắng ⇒ mặc định. */
export const tenantTz = (d: WithConfig) => async (tid: string) =>
  (await d.config.tenant(tid))?.timezone ?? DEFAULT_TENANT_TZ;

/** tenant-quotas · hạn mức ngày riêng của tenant (nạp lại theo `config_version`); vắng ⇒ env. */
export const tenantLimits = (d: WithConfig) => async (tid: string) =>
  (await d.config.tenant(tid))?.dailyLimits;

/** Env số nguyên dương, sai/vắng ⇒ mặc định. */
export const envInt = (k: string, def: number): number => {
  const n = Number(process.env[k]);
  return Number.isInteger(n) && n > 0 ? n : def;
};

/** cr125-contract-from-step · cổng tiêm cho gói Hợp đồng (gói không import module hub): bộ đọc tệp đính kèm hub — chỉ khi có `db` + kho tệp. */
export const stepDeps = (d: { db?: Db; attachments?: { storage: AttachmentStorage } }) =>
  d.db && d.attachments ? { attachmentBytes: attachmentBytesOf(d.db, d.attachments.storage) } : {};

/** CR-127 · E4b · cổng tiêm cho gói Hợp đồng: đọc byte tệp/chữ ký của bằng chứng duyệt (BR-26 kiểm ở gói) — chỉ khi có `db` + kho tệp. */
export const evidenceDeps = (d: { db?: Db; attachments?: { storage: AttachmentStorage } }) =>
  d.db && d.attachments
    ? {
        evidenceBytes: evidenceFileBytesOf(d.db, d.attachments.storage),
        evidenceNames: evidenceFileNamesOf(d.db), // U4b-3 · PDF Hồ sơ duyệt
        stampPng: stampPngOf(d.db), // CR-181 · s10 · hình chữ ký đã in
      }
    : {};

/** CR-181 · s10 · ảnh chữ ký đã in theo id: MỘT câu hub (scope hệ thống) lọc `tenant_id` + `= any(array)`; id tenant khác không có trong kết quả. Gói đã kiểm id thuộc HĐ. */
export const stampPngOf =
  (db: Db) =>
  async (tenantId: string, ids: readonly string[]): Promise<Map<string, Uint8Array>> => {
    if (ids.length === 0) return new Map();
    const rows = await withHubScope(db, { kind: "system" }, (tx) =>
      tx.execute<{
        id: string;
        png: Uint8Array;
      }>(sql`select id::text as id, png from hub.user_signatures
        where tenant_id = ${tenantId}::uuid and id = any(${`{${ids.join(",")}}`}::uuid[])`),
    );
    return new Map(rows.map((r) => [r.id, new Uint8Array(r.png)]));
  };
