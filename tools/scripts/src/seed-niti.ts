// tool-seed-niti · nạp tenant thật "NiTi Group": tenant + gói (Sổ Hợp Tác, Community; Admin theo vai tenant_admin) + phòng ban +
// người dùng + vai gói + 3 quy trình duyệt HĐ (thư viện, xuất bản, gán tenant) + luật chọn quy trình theo phòng ban × loại HĐ.
// CHẠY LẠI ĐƯỢC (không đổi ⇒ không ghi). Mặc định chạy thử (chỉ đọc); `--apply` mới ghi. Đi qua CHÍNH service của admin-api/hub-api
// (onboardTenant, createUser, grantGroup, DefsService/LibraryService/RoutingService) ⇒ RLS, audit, config_changed đúng.
//   docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/seed-niti.ts [--apply --i-know-prod] [--email-domain <miền>] [--cred-file <file>]
// Env: ADMIN_API_DATABASE_URL (‖ DATABASE_URL), HUB_DATABASE_URL (‖ DATABASE_URL). Mật khẩu tạm CHỈ vào file `$HOME/niti-credentials.txt`
// (quyền 600, ghi ngay khi tạo từng user), KHÔNG in ra stdout. User đã có ⇒ giữ nguyên (không reset mật khẩu).
import { appendFileSync, chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createDb, type Db, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import type { OnboardSpec } from "../../../apps/admin-api/src/modules/tenant-onboard/domain/onboard.rules";
import { onboardTenant } from "../../../apps/admin-api/src/modules/tenant-onboard/tenant-onboard.run";
import { createUser } from "../../../apps/admin-api/src/modules/users/users.service";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { grantGroup } from "./seed-community-demo.grant";
import { NITI_SPEC, type Person, type SeedSpec } from "./seed-niti.data";
import { applyGuard, credLine, emailOf, tenantShape } from "./seed-niti.rules";

export type SeedOpts = {
  apply: boolean;
  credFile: string;
  log?: (s: string) => void;
};
export type SeedReport = {
  tenant: "created" | "exists";
  usersCreated: string[];
  usersExisting: string[];
  roleGrants: number;
  credFile: string | null;
};

const rows = <T>(db: Db, q: ReturnType<typeof sql>): Promise<T[]> =>
  withScope(db, { kind: "platform" }, async (tx) => (await tx.execute(q)) as unknown as T[]);

/** Group vai gói theo vai của người (owner ⇒ *-owner, editor ⇒ *-editor) cho mọi gói của tenant. */
const roleGroups = (s: SeedSpec, p: Person): string[] => s.packs.map((k) => `${k}-${p.packRole}`);

async function platformActor(admin: Db) {
  const [u] = await rows<{ id: string; tenant_id: string; tenant_key: string }>(
    admin,
    sql`select u.id, u.tenant_id, t.key as tenant_key from admin.users u join admin.tenants t on t.id = u.tenant_id
      where u.role = 'platform_admin' and u.active order by u.created_at, u.id limit 1`,
  );
  if (!u) throw new Error("seed-niti: không có platform_admin đang hoạt động");
  return { userId: u.id, tenantId: u.tenant_id, tenantKey: u.tenant_key };
}

function onboardSpec(
  s: SeedSpec,
  cur: { timezone: string; profile: unknown } | null,
  people: boolean,
): OnboardSpec {
  const dept = (d: SeedSpec["root"]) => {
    const head = s.people.find((p) => p.dept === d.key && p.head);
    const members = s.people.filter((p) => p.dept === d.key && !p.head);
    return {
      key: d.key,
      vi: d.vi,
      en: d.en,
      ...(people && head ? { head: emailOf(head.username, s.emailDomain) } : {}),
      members: people ? members.map((p) => emailOf(p.username, s.emailDomain)) : [],
    };
  };
  return {
    key: s.tenantKey,
    name: s.tenantName,
    timezone: cur?.timezone ?? s.timezone,
    profile: (cur?.profile ?? {}) as Record<string, unknown>,
    packs: s.packs,
    root: dept(s.root),
    departments: s.departments.map(dept),
  };
}

function appendCred(file: string, line: string): void {
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, "", { mode: 0o600 });
  appendFileSync(file, line);
  try {
    chmodSync(file, 0o600);
  } catch {
    /* hệ tệp không hỗ trợ quyền POSIX */
  }
}

type Cur = { timezone: string; profile: unknown } | null;
type Actor = { userId: string; tenantId: string; tenantKey: string };

/** Ghi phía admin: tenant+gói+phòng ban → user (mật khẩu vào file NGAY) → trưởng phòng/thành viên → vai gói. */
async function applyAdmin(
  admin: Db,
  s: SeedSpec,
  cur: Cur,
  actor: Actor,
  missing: Person[],
  o: SeedOpts,
  res: SeedReport,
): Promise<void> {
  await onboardTenant(admin, onboardSpec(s, cur, false), actor.userId);
  const tid = (
    await rows<{ id: string }>(admin, sql`select id from admin.tenants where key = ${s.tenantKey}`)
  )[0]?.id as string;
  const call = {
    ctx: { db: admin },
    actor: {
      userId: actor.userId,
      tenantId: actor.tenantId,
      tenantKey: actor.tenantKey,
      role: "platform_admin" as const,
      sid: null,
    },
    scope: { kind: "platform" as const },
  };
  for (const p of missing) {
    const r = await createUser(call as never, tid, {
      username: p.username,
      display_name: p.display,
      email: emailOf(p.username, s.emailDomain),
      role: p.role,
      locale: "vi",
    });
    appendCred(o.credFile, credLine(s.tenantKey, p.username, r.temp_password)); // ghi NGAY, trước khi làm bước khác
    res.credFile = o.credFile;
  }
  const rep = await onboardTenant(admin, onboardSpec(s, cur, true), actor.userId);
  if (rep.members.pending_emails.length > 0)
    throw new Error(`seed-niti: email chưa khớp user: ${rep.members.pending_emails.join(", ")}`);
  const byGroup = new Map<string, string[]>();
  for (const p of s.people)
    for (const g of roleGroups(s, p)) byGroup.set(g, [...(byGroup.get(g) ?? []), p.username]);
  for (const [g, names] of byGroup)
    res.roleGrants += (await grantGroup(admin, s.tenantKey, g, names)).length;
}

/** Seed tenant + gói + phòng ban + user + vai gói. KHÔNG tạo quy trình/luật (CR-127: quy trình tạo từ sơ đồ trống ở màn công ty); `_hub` giữ chữ ký cũ. */
export async function runSeed(admin: Db, _hub: Db, s: SeedSpec, o: SeedOpts): Promise<SeedReport> {
  const log = o.log ?? console.log;
  const found = await rows<{
    id: string;
    key: string;
    name: string;
    timezone: string;
    profile: unknown;
  }>(
    admin,
    sql`select id, key, name, timezone, profile from admin.tenants where key = ${s.tenantKey} or lower(name) = lower(${s.tenantName})`,
  );
  const shape = tenantShape(s, found);
  if (shape !== "absent" && shape !== "present") throw new Error(`seed-niti: ${shape}`);
  const cur = found[0] ?? null;
  const actor = await platformActor(admin);
  const dry = !o.apply;

  const existing = cur
    ? new Set(
        (
          await rows<{ username: string }>(
            admin,
            sql`select username from admin.users where tenant_id = ${cur.id}::uuid`,
          )
        ).map((r) => r.username),
      )
    : new Set<string>();
  const missing = s.people.filter((p) => !existing.has(p.username));
  const res: SeedReport = {
    tenant: cur ? "exists" : "created",
    usersCreated: missing.map((p) => p.username),
    usersExisting: s.people.filter((p) => existing.has(p.username)).map((p) => p.username),
    roleGrants: 0,
    credFile: null,
  };

  if (!dry) await applyAdmin(admin, s, cur, actor, missing, o, res);

  log(summary(s, res, dry));
  return res;
}

/** Tóm tắt — CHỈ username/khoá/đường dẫn file; không bao giờ có mật khẩu. */
function summary(s: SeedSpec, r: SeedReport, dry: boolean): string {
  const l = [
    `seed-niti: ${dry ? "chạy thử (thêm --apply để ghi)" : "đã ghi"} — tenant ${s.tenantKey} "${s.tenantName}": ${r.tenant === "created" ? "sẽ tạo/tạo" : "đã có"}; gói ${s.packs.join("+")} (+ app Admin theo vai tenant_admin)`,
    `  phòng ban: ${[s.root, ...s.departments].map((d) => d.vi).join(", ")}`,
    `  user mới: ${r.usersCreated.join(", ") || "(không)"}; đã có: ${r.usersExisting.join(", ") || "(không)"}${dry ? "" : `; gán vai gói mới: ${r.roleGrants}`}`,
    r.credFile ? `  file mật khẩu tạm (không in nội dung): ${r.credFile}` : "",
  ];
  return l.filter(Boolean).join("\n");
}

async function main(argv: readonly string[]): Promise<void> {
  const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const adminUrl = process.env.ADMIN_API_DATABASE_URL ?? process.env.DATABASE_URL;
  const hubUrl = process.env.HUB_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!adminUrl || !hubUrl)
    throw new Error("seed-niti: cần ADMIN_API_DATABASE_URL/HUB_DATABASE_URL (hoặc DATABASE_URL)");
  const apply = argv.includes("--apply");
  const why = applyGuard({
    apply,
    iKnowProd: argv.includes("--i-know-prod"),
    appEnv: process.env.APP_ENV,
    urls: [adminUrl, hubUrl],
  });
  if (why) throw new Error(`seed-niti: từ chối — ${why}`);
  const spec = { ...NITI_SPEC, emailDomain: arg("--email-domain") ?? NITI_SPEC.emailDomain };
  const admin = createDb(adminUrl, { max: 2 });
  const hub = connectDb(hubUrl, 2);
  try {
    await runSeed(admin, hub, spec, {
      apply,
      credFile: arg("--cred-file") ?? join(homedir(), "niti-credentials.txt"),
    });
  } finally {
    await admin.close();
    await hub.close();
  }
}

if (import.meta.main) await main(process.argv.slice(2));
