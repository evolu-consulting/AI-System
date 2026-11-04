// tool-tenant-purge · xoá SẠCH một tenant: mọi bảng có `tenant_id` (admin.*, hub.*, mọi schema gói) + allowlist bảng không có
// `tenant_id` + hàng admin.tenants, trong MỘT transaction; rồi xoá file FileBox của tenant (sau commit, báo còn sót, chạy lại được).
// Mặc định CHẠY THỬ (transaction read only, in số hàng theo bảng). Chốt chặn: tenant platform, tên/uuid trùng, bảng lạ, dữ liệu tenant
// khác trỏ vào, `--apply` bắt buộc `--confirm "<tên chính xác>"`. Trên máy chủ (DATABASE_URL = owner do compose cấp, như s2-app-urls):
//   docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/tenant-purge.ts --tenant <uuid|tên> [--apply --confirm "<tên>"]
//     [--actor <username platform_admin>] [--state /claude-home/tenant-purge-<uuid>.json] [--skip-files]
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { type Applied, applyPurge } from "./tenant-purge.apply";
import {
  buildPlan,
  countRows,
  crossTenantRefs,
  readCatalog,
  readTenants,
  stillReferenced,
  tenantFileIds,
} from "./tenant-purge.db";
import {
  envFileStore,
  type FileReport,
  type FileStore,
  purgeFiles,
  readState,
  writeState,
} from "./tenant-purge.files";
import {
  type Counts,
  checkConfirm,
  describeCounts,
  EXTRA_TABLES,
  type ExtraTable,
  isUuid,
  type Plan,
  type PurgeArgs,
  PurgeRefused,
  parsePurgeArgs,
  pickTenant,
  type TenantRow,
} from "./tenant-purge.rules";

export type PurgeDeps = {
  files: FileStore | null;
  log: (s: string) => void;
  operator: string;
  statePath: (tenantId: string) => string;
  extra?: readonly ExtraTable[];
};

type DbPhase =
  | { kind: "gone" }
  | { kind: "dry"; t: TenantRow; plan: Plan; counts: Counts; fileIds: string[] }
  | ({ kind: "applied"; t: TenantRow; plan: Plan; counts: Counts; fileIds: string[] } & Applied);

export type PurgeOutcome = DbPhase & { files?: FileReport };

async function resolveActor(
  tx: postgres.TransactionSql,
  username?: string,
): Promise<string | null> {
  if (!username) return null;
  const [u] = (await tx.unsafe(
    `select u.id::text as id from admin.users u join admin.tenants t on t.id = u.tenant_id
     where u.username = $1 and u.role = 'platform_admin'`,
    [username],
  )) as unknown as { id: string }[];
  if (!u) throw new PurgeRefused(`--actor ${username} không phải platform_admin`);
  return u.id;
}

/** Pha DB: một transaction (read only khi chạy thử). */
async function dbPhase(sql: postgres.Sql, a: PurgeArgs, d: PurgeDeps): Promise<DbPhase> {
  return sql.begin(a.apply ? "read write" : "read only", async (tx) => {
    // Owner bỏ RLS; nếu role chạy không bỏ được RLS thì câu lệnh LỖI thay vì lặng lẽ thấy thiếu hàng.
    await tx.unsafe("set local row_security = off");
    await tx.unsafe("set local lock_timeout = '15s'");
    const t = pickTenant(await readTenants(tx), a.tenant);
    if (!t) return { kind: "gone" } as const;
    checkConfirm(t, a);
    const cat = await readCatalog(tx);
    const plan = buildPlan(cat, d.extra ?? EXTRA_TABLES);
    await crossTenantRefs(tx, plan, cat.fks, t.id);
    const counts = await countRows(tx, plan, t.id);
    const fileIds = await tenantFileIds(tx, plan, t.id);
    if (!a.apply) return { kind: "dry", t, plan, counts, fileIds } as const;
    const actorId = await resolveActor(tx, a.actor);
    const applied = await applyPurge(tx, plan, t, {
      actorId,
      operator: d.operator,
      files: fileIds.length,
    });
    // Ghi trạng thái file TRƯỚC commit: commit xong mà tiến trình chết ⇒ lần chạy lại vẫn biết id cần xoá.
    await writeState(d.statePath(t.id), {
      tenantId: t.id,
      name: t.name,
      at: new Date().toISOString(),
      fileIds,
      leftovers: fileIds,
      skipped: [],
    });
    return { kind: "applied", t, plan, counts, fileIds, ...applied } as const;
  }) as Promise<DbPhase>;
}

async function filePhase(
  sql: postgres.Sql,
  d: PurgeDeps,
  t: { id: string; name: string },
  ids: string[],
): Promise<FileReport | undefined> {
  if (!d.files) {
    d.log(
      `  FileBox chưa cấu hình (FILEBOX_URL/FILEBOX_TOKEN): ${ids.length} id giữ ở ${d.statePath(t.id)} — chạy lại sau`,
    );
    return undefined;
  }
  const referenced = await stillReferenced(sql, ids);
  const r = await purgeFiles(d.files, t.id, ids, referenced);
  await writeState(d.statePath(t.id), {
    tenantId: t.id,
    name: t.name,
    at: new Date().toISOString(),
    fileIds: ids,
    leftovers: r.leftovers,
    skipped: r.skipped,
  });
  d.log(
    `  FileBox: xoá ${r.deleted}, đã mất sẵn ${r.missing}, giữ (tenant khác còn dùng) ${r.skipped.length}, còn sót ${r.leftovers.length}`,
  );
  for (const id of r.leftovers) d.log(`    còn sót ${id}`);
  return r;
}

/** Tenant đã xoá khỏi DB (lần chạy trước): chỉ còn dọn FileBox theo file trạng thái + org `t_<uuid>`. */
async function gonePhase(sql: postgres.Sql, a: PurgeArgs, d: PurgeDeps): Promise<PurgeOutcome> {
  if (!isUuid(a.tenant)) throw new PurgeRefused(`không có tenant "${a.tenant}"`);
  const st = await readState(d.statePath(a.tenant));
  const name = st?.name ?? a.tenant;
  const ids = st ? [...new Set([...st.leftovers, ...st.skipped])] : [];
  d.log(
    `tenant-purge[${a.tenant}]: tenant không còn trong DB — chỉ dọn FileBox (${ids.length} id từ trạng thái + org)`,
  );
  if (!a.apply || a.skipFiles) return { kind: "gone" };
  if (a.confirm !== name) throw new PurgeRefused(`--confirm phải là "${name}"`);
  return { kind: "gone", files: await filePhase(sql, d, { id: a.tenant, name }, ids) };
}

export async function runPurge(
  sql: postgres.Sql,
  a: PurgeArgs,
  d: PurgeDeps,
): Promise<PurgeOutcome> {
  const r = await dbPhase(sql, a, d);
  if (r.kind === "gone") return gonePhase(sql, a, d);
  const head = r.kind === "dry" ? "CHẠY THỬ (thêm --apply --confirm để xoá)" : "ĐÃ XOÁ (đã commit)";
  d.log(`tenant-purge[${r.t.key} · ${r.t.name} · ${r.t.id}]: ${head}`);
  for (const s of describeCounts(r.plan.order, r.counts, r.kind === "dry" ? "sẽ xoá" : "xoá"))
    d.log(s);
  for (const f of r.plan.nulledFrom)
    d.log(`  đặt NULL (FK ${f.name}): ${f.child}.${f.cols.join(",")}`);
  d.log(`  FileBox: ${r.fileIds.length} id từ dữ liệu + org t_${r.t.id}`);
  if (r.kind === "dry" || a.skipFiles) return r;
  d.log(
    `  config_version=${r.versions.config} profile_version=${r.versions.profile} hub_config_version=${r.versions.hub} (đã NOTIFY)`,
  );
  return { ...r, files: await filePhase(sql, d, r.t, r.fileIds) };
}

/** uid trong container có thể không có trong /etc/passwd ⇒ `userInfo()` ném. */
function osUser(): string {
  try {
    return `os:${userInfo().username}`;
  } catch {
    return `uid:${process.getuid?.() ?? "?"}`;
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const a = parsePurgeArgs(argv);
  const url = process.env.DATABASE_URL;
  if (!url) throw new PurgeRefused("thiếu DATABASE_URL (owner)");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const dir = homedir();
  try {
    await runPurge(sql, a, {
      files: envFileStore(),
      log: (s) => console.log(s),
      operator: a.actor ?? osUser(),
      statePath: (id) => a.state ?? join(dir, `tenant-purge-${id}.json`),
    });
  } finally {
    await sql.end();
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
