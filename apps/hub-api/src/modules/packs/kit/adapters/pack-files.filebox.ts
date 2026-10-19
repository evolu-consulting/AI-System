// PK-FR-06 · D-07 · ADR-0015 · N1 plan §6: `PackFiles` trên FileBox — mỗi lời gọi dùng client của org `t_<tenant_id>` (tenant
// lấy từ token). `link`: đọc hàng `<k>.files` trong tx RLS của tenant (1 câu) ⇒ không có ⇒ null, KHÔNG gọi FileBox; org lệch
// ⇒ null + log `pack-file-org-mismatch`. Gọi FileBox NGOÀI tx (không giữ kết nối DB khi chờ mạng). Log chỉ `{pack, row_id}` —
// không `file_id`, không URL `/d/`. Client FileBox được tiêm (`packs.mount.ts` là chỗ duy nhất import `filebox.client`).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PackFileRow, PackFiles, PackFilesRepo } from "../application/pack-files.ports";
import { orgForTenant } from "../application/pack-files.ports";
import type { PackUow } from "../application/ports";

/** Phần client FileBox cần (khớp cấu trúc `FileboxClient`). */
export type PackFileboxClient = {
  postFile(name: string, bytes: Uint8Array): Promise<{ fileId: string; versionId: string }>;
  getLink(fileId: string): Promise<string | null>;
  deleteFile(fileId: string): Promise<"deleted" | "missing">;
};

export type PackFilesRepos = { files: PackFilesRepo };

type Row = { id: string; org: string; file_id: string };
const toRow = (r: Row | undefined): PackFileRow | null =>
  r ? { id: r.id, org: r.org, fileId: r.file_id } : null;

/** Repo `<k>.files` (SQL văn bản hằng theo gói; schema = khoá gói đã kiểm bởi `withPackScope`). */
export function packFilesRepo(packKey: string) {
  const t = sql`${sql.identifier(packKey)}.files`;
  return (tx: Tx, tenantId: string): PackFilesRepo => ({
    find: async (rowId) => {
      const rows = await tx.execute<Row>(sql`select id, org, file_id from ${t}
        where id = ${rowId}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null`);
      return toRow(rows[0]);
    },
    insert: async (r) => {
      await tx.execute(sql`insert into ${t}
          (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
        values (${r.id}::uuid, ${tenantId}::uuid, ${r.org}, ${r.fileId}, ${r.versionId}, ${r.name}, ${r.mime},
          ${r.sizeBytes}, ${r.createdBy}::uuid)`);
    },
    softDelete: async (rowId) => {
      const rows = await tx.execute<Row>(sql`update ${t} set deleted_at = now()
        where id = ${rowId}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null
        returning id, org, file_id`);
      return toRow(rows[0]);
    },
  });
}

export type PackFilesDeps = {
  packKey: string;
  uow: PackUow<PackFilesRepos>;
  /** Client FileBox cho một org (mỗi lời gọi một org theo tenant). */
  client: (org: string) => PackFileboxClient;
  log: { warn(msg: string, fields?: Record<string, unknown>): void };
  newId: () => string;
};

export function createPackFiles(d: PackFilesDeps): PackFiles {
  /** Hàng phải thuộc org của tenant gọi (CHECK ở DB đã bảo đảm; kiểm lại ở đây — phòng thủ chiều sâu). */
  const own = (row: PackFileRow | null, tenantId: string): row is PackFileRow => {
    if (!row) return false;
    if (row.org === orgForTenant(tenantId)) return true;
    d.log.warn("pack-file-org-mismatch", { pack: d.packKey, row_id: row.id });
    return false;
  };
  return {
    put: async (who, f) => {
      const org = orgForTenant(who.tenantId);
      const fb = d.client(org);
      const up = await fb.postFile(f.name, f.bytes);
      const id = d.newId();
      try {
        await d.uow.tenant(who, (r) =>
          r.files.insert({
            id,
            org,
            fileId: up.fileId,
            versionId: up.versionId,
            name: f.name,
            mime: f.mime,
            sizeBytes: f.bytes.byteLength,
            createdBy: who.userId,
          }),
        );
      } catch (e) {
        await fb.deleteFile(up.fileId).catch(() => "missing"); // không để file mồ côi ở FileBox
        throw e;
      }
      return { id };
    },
    link: async (who, rowId) => {
      const row = await d.uow.tenant(who, (r) => r.files.find(rowId));
      if (!own(row, who.tenantId)) return null;
      return d.client(row.org).getLink(row.fileId);
    },
    remove: async (who, rowId) => {
      const row = await d.uow.tenant(who, (r) => r.files.softDelete(rowId));
      if (!own(row, who.tenantId)) return false;
      await d.client(row.org).deleteFile(row.fileId);
      return true;
    },
  };
}
