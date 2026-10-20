// I1 · lớp 4: nối adapter (OpenSearch/Neo4j REST chỉ-đọc, Postgres `admin_api` + `hub_api` NOBYPASSRLS, file) với use case.
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { Db } from "@ai/db";
import { createDirSink, createDirSource } from "./adapters/files.adapter";
import { createIdentityAdapter } from "./adapters/identity.adapter";
import { createNeo4jReader } from "./adapters/neo4j.reader";
import { createOpenSearchReader } from "./adapters/opensearch.reader";
import { createTargetStore, visibleContracts } from "./adapters/target.repo";
import { type ImportReport, runImport } from "./application/import.usecase";
import type { Checkpoint, ImportDeps, ImportOpts, SourceReader } from "./application/ports";

export type RunConfig = ImportOpts & {
  opensearch: { url: string; prefix?: string };
  neo4j: { url: string; user: string; password: string } | null;
  /** Thư mục `contract_files` của mgmt-app (bản chép chỉ-đọc). */
  filesDir: string | null;
  /** Kho file đích dạng thư mục (bản sao seed). FileBox cho cutover thật: xem tasks.md "Còn lại". */
  sinkDir: string | null;
  /** File điểm dừng (chạy tiếp sau khi đứt). */
  statePath: string | null;
  /** niti-onboard: key tenant đích (đã onboarding + gắn org); vắng ⇒ mỗi org một tenant (I1 gốc). */
  intoTenant?: string | null;
};

/** Điểm dừng lưu file JSON `{done: [...]}`; không có đường dẫn ⇒ chỉ trong bộ nhớ. */
export function fileCheckpoint(path: string | null): Checkpoint {
  const done = new Set<string>(
    path && existsSync(path)
      ? ((JSON.parse(readFileSync(path, "utf8")) as { done?: string[] }).done ?? [])
      : [],
  );
  return {
    done: (k) => done.has(k),
    mark: async (k) => {
      done.add(k);
      if (path) await writeFile(path, JSON.stringify({ done: [...done] }));
    },
  };
}

export function sourceReader(c: RunConfig): SourceReader {
  const os = createOpenSearchReader(c.opensearch);
  const neo = c.neo4j ? createNeo4jReader(c.neo4j) : null;
  return {
    scan: os.scan,
    count: os.count,
    graph: neo ? neo.graph : async function* () {},
  };
}

/** Nối adapter thật (tách riêng để test int bọc một cổng — vd đích lỗi giữa chừng — mà vẫn dùng mọi adapter khác). */
export function buildDeps(adminDb: Db, hubDb: Db, c: RunConfig, reader: SourceReader): ImportDeps {
  return {
    reader,
    identity: createIdentityAdapter(adminDb, c.actorId, Math.min(c.batch, 1000)),
    target: createTargetStore(hubDb, c.source),
    files: {
      source: c.filesDir ? createDirSource(c.filesDir) : null,
      sink: c.sinkDir ? createDirSink(c.sinkDir) : null,
    },
    checkpoint: fileCheckpoint(c.statePath),
    visible: (tid, uid) => visibleContracts(hubDb, tid, uid),
    now: () => performance.now(),
  };
}

export type IntoReport = { key: string; tenant_id: string; org_id: string | null };

/**
 * niti-onboard · `--into-tenant <key>`: nhập ĐÚNG org đã gắn với tenant (marker onboarding, cùng `--source`). Tenant lạ/đã tắt ⇒
 * lỗi. Chưa gắn: apply ⇒ lỗi `TENANT_NOT_BOUND`; dry-run ⇒ chạy với 0 org (báo `source_orgs` để chọn) + vấn đề `into.*`.
 */
async function resolveInto(d: ImportDeps, c: RunConfig, key: string) {
  const t = await d.identity.tenantByKey(key);
  if (!t) throw new Error("TENANT_NOT_FOUND");
  if (!t.active) throw new Error("TENANT_INACTIVE");
  const bound = t.source === c.source && t.orgId !== null;
  if (!bound && c.apply) throw new Error("TENANT_NOT_BOUND");
  return { key, tenant_id: t.id, org_id: bound ? t.orgId : null } satisfies IntoReport;
}

export async function runMgmtImport(
  adminDb: Db,
  hubDb: Db,
  c: RunConfig,
  reader: SourceReader = sourceReader(c),
): Promise<ImportReport & { into?: IntoReport }> {
  const deps = buildDeps(adminDb, hubDb, c, reader);
  if (!c.intoTenant) return runImport(c, deps);
  const into = await resolveInto(deps, c, c.intoTenant);
  // chưa gắn (dry-run): org "" không khớp org nào ⇒ không lập kế hoạch cho ai
  const r = await runImport({ ...c, onlyOrg: into.org_id ?? "" }, deps);
  if (!into.org_id) r.issues_by_code["into.TENANT_NOT_BOUND"] = 1;
  return { ...r, into };
}
