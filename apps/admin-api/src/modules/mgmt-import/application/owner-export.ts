// niti-import · export CHỈ-ĐỌC từ mgmt-app: đọc các index (trừ `chunks` — đoạn văn bản tri thức, không nhập ở chế độ này) qua
// `SourceReader`, rồi (a) không email ⇒ chỉ liệt kê chủ HĐ (tìm email của tài khoản cần nhập), (b) có email ⇒ file export đã lọc
// đúng tài khoản đó (`scopeToOwner`) + số bản ghi bị loại/không nhập. Không ghi gì vào nguồn.
import type { Snapshot } from "../domain/context";
import { contractOwners, scopeToOwner } from "../domain/owner-scope.rules";
import { INDICES } from "./load";
import type { ExportMeta } from "./owner-ports";
import type { SourceReader } from "./ports";

export const EXPORT_FORMAT = "mgmt-export/v1";
export const EXPORT_INDICES = INDICES.filter((x) => x !== "chunks");

export type ExportFile = ExportMeta & { format: typeof EXPORT_FORMAT; docs: Snapshot["docs"] };

export async function loadIndices(
  r: SourceReader,
  batch: number,
  indices: readonly string[] = EXPORT_INDICES,
): Promise<Snapshot> {
  const s: Snapshot = { docs: {}, graph: {} };
  for (const ix of indices) {
    const list: Snapshot["docs"][string] = [];
    for await (const page of r.scan(ix, batch)) list.push(...page);
    s.docs[ix] = list;
  }
  return s;
}

export function exportFor(s: Snapshot, ownerEmail: string, now: Date): ExportFile {
  const scope = scopeToOwner(s, ownerEmail);
  return {
    format: EXPORT_FORMAT,
    owner_email: ownerEmail.trim().toLowerCase(),
    exported_at: now.toISOString(),
    source_orgs: scope.orgs,
    excluded: scope.excluded,
    not_imported: scope.not_imported,
    counts_all: Object.fromEntries(Object.entries(s.docs).map(([k, v]) => [k, v.length])),
    docs: scope.snap.docs,
  };
}

export async function runExport(
  r: SourceReader,
  o: { batch: number; ownerEmail: string | null; now: Date },
): Promise<{ owners: ReturnType<typeof contractOwners>; file: ExportFile | null }> {
  const s = await loadIndices(r, o.batch);
  return {
    owners: contractOwners(s),
    file: o.ownerEmail ? exportFor(s, o.ownerEmail, o.now) : null,
  };
}

/** Đọc file export (đã kiểm định dạng) thành `SourceReader` bộ nhớ + siêu dữ liệu. */
export function exportReader(raw: unknown): { reader: SourceReader; meta: ExportMeta } {
  const f = raw as Partial<ExportFile> | null;
  if (!f || f.format !== EXPORT_FORMAT || typeof f.docs !== "object" || !f.owner_email)
    throw new Error("EXPORT_FORMAT");
  const docs = f.docs as Snapshot["docs"];
  const { docs: _d, format: _f, ...meta } = f as ExportFile;
  return {
    meta,
    reader: {
      async *scan(index, batch) {
        const all = docs[index] ?? [];
        for (let i = 0; i < all.length; i += batch) yield all.slice(i, i + batch);
      },
      count: async (index) => (docs[index] ?? []).length,
      async *graph() {},
    },
  };
}
