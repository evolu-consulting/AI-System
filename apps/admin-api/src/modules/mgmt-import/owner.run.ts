// niti-import · lớp 4: nối chế độ MỘT tài khoản (nhập / hoàn tác) với adapter thật — nguồn = file export (`--from-export`, mặc
// định cho production) hoặc OpenSearch chỉ-đọc; đích = Postgres `hub_api`/`admin_api` (NOBYPASSRLS) + kho file (FileBox/thư mục).
import { readFile } from "node:fs/promises";
import { TENANT_TZ_DEFAULT } from "@ai/contracts";
import type { Db } from "@ai/db";
import { createOwnerStore } from "./adapters/owner.repo";
import { exportReader } from "./application/owner-export";
import { type OwnerReport, runOwnerImport } from "./application/owner-import.usecase";
import type { ExportMeta, OwnerDeps } from "./application/owner-ports";
import { type RollbackReport, runOwnerRollback } from "./application/owner-rollback.usecase";
import type { SourceReader } from "./application/ports";
import { buildDeps, type RunConfig, sourceReader } from "./mgmt-import.run";

export type OwnerRunConfig = RunConfig & {
  tenantKey: string;
  ownerEmail: string | null;
  ownerUsername: string | null;
  exportFile: string | null;
  rollback: boolean;
  /** Múi tenant cho "hôm nay" (mốc nhắc đã qua); mặc định VN. */
  timeZone?: string;
  now?: () => Date;
};

/** Ngày lịch YYYY-MM-DD ở múi `tz`. */
export const localDay = (now: Date, tz: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

async function source(
  c: OwnerRunConfig,
): Promise<{ reader: SourceReader; meta: ExportMeta | null }> {
  if (!c.exportFile) return { reader: sourceReader(c), meta: null };
  return exportReader(JSON.parse(await readFile(c.exportFile, "utf8")));
}

export async function runOwner(
  adminDb: Db,
  hubDb: Db,
  c: OwnerRunConfig,
  src?: { reader: SourceReader; meta: ExportMeta | null },
): Promise<OwnerReport | RollbackReport> {
  const { reader, meta } = src ?? (await source(c));
  const d: OwnerDeps = { ...buildDeps(adminDb, hubDb, c, reader), owner: createOwnerStore(hubDb) };
  if (c.rollback)
    return runOwnerRollback({ source: c.source, apply: c.apply, tenantKey: c.tenantKey }, d);
  if (!c.ownerEmail || !c.ownerUsername) throw new Error("OWNER_ARGS");
  return runOwnerImport(
    {
      source: c.source,
      apply: c.apply,
      batch: c.batch,
      actorId: c.actorId,
      tenantKey: c.tenantKey,
      ownerEmail: c.ownerEmail,
      ownerUsername: c.ownerUsername,
      today: localDay((c.now ?? (() => new Date()))(), c.timeZone ?? TENANT_TZ_DEFAULT),
      meta,
    },
    d,
  );
}

/** exit 2: vấn đề hàng / lệch tiền / sai sha / hoàn tác bị từ chối. */
export function ownerBad(r: OwnerReport | RollbackReport): boolean {
  if ("error" in r) return r.error !== null;
  return Object.keys(r.issues_by_code).length > 0 || !r.money_ok;
}
