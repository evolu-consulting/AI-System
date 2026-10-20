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

export async function runMgmtImport(
  adminDb: Db,
  hubDb: Db,
  c: RunConfig,
  reader: SourceReader = sourceReader(c),
): Promise<ImportReport> {
  return runImport(c, buildDeps(adminDb, hubDb, c, reader));
}
