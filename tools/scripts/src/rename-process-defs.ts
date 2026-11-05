// CR-120 · đổi tên một lần: quy trình thư viện của khe `contracts.approval` về tên theo BƯỚC ("Duyệt 2 cấp: Kế toán → Giám đốc"),
// khoá GIỮ NGUYÊN. Tìm theo khoá (3 quy trình NiTi + `hd-mac-dinh`); chạy lại được (đã đúng tên ⇒ không ghi).
// Mặc định CHẠY THỬ (chỉ đọc, in kế hoạch); `--apply` mới ghi — đi qua DefsService.update (audit + version + config_changed), rồi xuất bản
// lại bản đang chạy khi trước đó nháp không có thay đổi chờ (tên nằm trong so sánh "có thay đổi chưa xuất bản").
//   docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/rename-process-defs.ts [--apply --i-know-prod]
// Env: ADMIN_API_DATABASE_URL (‖ DATABASE_URL), HUB_DATABASE_URL (‖ DATABASE_URL). KHÔNG chạy trên prod khi chưa được người dùng cho phép.
import { createDb, type Db, withScope } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import type { ProcessDeps } from "../../../apps/hub-api/src/modules/processes/core/ports";
import { toProcessDef } from "../../../apps/hub-api/src/modules/processes/defs/defs.map";
import { readDef } from "../../../apps/hub-api/src/modules/processes/defs/defs.repo";
import { DefsService } from "../../../apps/hub-api/src/modules/processes/defs/defs.service";
import { LibraryService } from "../../../apps/hub-api/src/modules/processes/library/library.service";
import { type FoundDef, planRenames, RENAMES, type RenameStep } from "./rename-process-defs.rules";
import { approvalPackTools } from "./seed-niti";
import { SLOT } from "./seed-niti.data";
import { applyGuard } from "./seed-niti.rules";

const LIB_SCOPE = { tenantId: null, library: true } as const;
const COPY_KEYS = [
  "description",
  "input_hint",
  "run_group_ids",
  "stages",
  "token_budget",
  "enabled",
  "sources",
  "inputs",
  "ttl_days",
] as const;

export type RenameReport = { steps: RenameStep[]; applied: number };

async function findDefs(hub: Db): Promise<FoundDef[]> {
  const keys = RENAMES.map((r) => r.key);
  return withHubScope(hub, { kind: "system" }, async (tx) => {
    const r = (await tx.execute(sql`select id, key, name from hub.process_defs
      where key = any(${keys}::text[]) and slot = ${SLOT} and tenant_id is null and deleted_at is null`)) as unknown as FoundDef[];
    return [...r];
  });
}

async function platformAdmin(admin: Db): Promise<{ userId: string; tenantId: string }> {
  const [u] = await withScope(admin, { kind: "platform" }, async (tx) => {
    const r = await tx.execute(sql`select id, tenant_id from admin.users
      where role = 'platform_admin' and active order by created_at, id limit 1`);
    return r as unknown as { id: string; tenant_id: string }[];
  });
  if (!u) throw new Error("rename-process-defs: không có platform_admin đang hoạt động");
  return { userId: u.id, tenantId: u.tenant_id };
}

async function renameOne(hub: Db, u: unknown, s: Extract<RenameStep, { state: "rename" }>) {
  const deps = { db: hub, packTools: approvalPackTools(), start: {} } as unknown as ProcessDeps;
  const defs = new DefsService(deps);
  const lib = new LibraryService({ db: hub, packTools: approvalPackTools() } as never);
  const read = () => withHubScope(hub, { kind: "system" }, (tx) => readDef(tx, LIB_SCOPE, s.id));
  const row = await read();
  if (!row) throw new Error(`rename-process-defs: không đọc được ${s.key}`);
  const wasClean = row.published_version != null && row.has_unpublished_changes !== true;
  const d = toProcessDef(row) as unknown as Record<string, unknown> & { version: number };
  const input = Object.fromEntries(COPY_KEYS.map((k) => [k, d[k]]));
  await defs.update(u as never, LIB_SCOPE as never, s.id, {
    ...input,
    key: s.key,
    name: s.to,
    slot: SLOT,
    slot_body: d.slot_body,
    version: d.version,
  } as never);
  if (wasClean) {
    const v = (await read())?.version as number;
    await lib.publish(u as never, s.id, { version: v, note: "CR-120: đổi tên theo bước" });
  }
}

export async function runRename(
  admin: Db,
  hub: Db,
  o: { apply: boolean; log?: (s: string) => void },
): Promise<RenameReport> {
  const log = o.log ?? console.log;
  const steps = planRenames(await findDefs(hub));
  const todo = steps.filter(
    (s): s is Extract<RenameStep, { state: "rename" }> => s.state === "rename",
  );
  if (o.apply) {
    const a = await platformAdmin(admin);
    const u = { userId: a.userId, tenantId: a.tenantId, role: "platform_admin" };
    for (const s of todo) await renameOne(hub, u, s);
  }
  for (const s of steps) log(describe(s, o.apply));
  log(
    o.apply
      ? `rename-process-defs: đã đổi ${todo.length}`
      : "rename-process-defs: chạy thử — thêm --apply để ghi",
  );
  return { steps, applied: o.apply ? todo.length : 0 };
}

const describe = (s: RenameStep, apply: boolean): string => {
  if (s.state === "rename")
    return `  ${s.key}: "${s.from}" -> "${s.to}"${apply ? " (đã đổi)" : ""}`;
  return `  ${s.key}: ${s.state === "same" ? "đã đúng tên" : "không có (bỏ qua)"}`;
};

async function main(argv: readonly string[]): Promise<void> {
  const adminUrl = process.env.ADMIN_API_DATABASE_URL ?? process.env.DATABASE_URL;
  const hubUrl = process.env.HUB_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!adminUrl || !hubUrl)
    throw new Error(
      "rename-process-defs: cần ADMIN_API_DATABASE_URL/HUB_DATABASE_URL (hoặc DATABASE_URL)",
    );
  const apply = argv.includes("--apply");
  const why = applyGuard({
    apply,
    iKnowProd: argv.includes("--i-know-prod"),
    appEnv: process.env.APP_ENV,
    urls: [adminUrl, hubUrl],
  });
  if (why) throw new Error(`rename-process-defs: từ chối — ${why}`);
  const admin = createDb(adminUrl, { max: 2 });
  const hub = connectDb(hubUrl, 2);
  try {
    await runRename(admin, hub, { apply });
  } finally {
    await admin.close();
    await hub.close();
  }
}

if (import.meta.main) await main(process.argv.slice(2));
