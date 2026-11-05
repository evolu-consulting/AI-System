// e2e-journey-approval · tenant kiểm thử HÀNH TRÌNH duyệt hợp đồng (khoá `e2e-approval`): dựng ĐÚNG như seed-niti (onboardTenant + createUser +
// vai gói + quy trình thư viện) nhưng KHÔNG gán quy trình / KHÔNG đặt luật chọn (CR-121 D-4: gán là đủ, không còn feature nào phải bật) —
// platform admin làm ở ai-admin (đó là phần e2e kiểm). Dùng cho stack e2e (DB test) và e2e triển khai (`e2e/deployed/21-*`).
// CHẠY LẠI ĐƯỢC. CHỈ chạm tenant có khoá bắt đầu `e2e-` (không bao giờ NiTi/Demo); mật khẩu cố định cho cả 4 tài khoản lấy từ env
// `E2E_JOURNEY_PW` (không in, không ghi file; không phải đổi mật khẩu lần đầu).
//   docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/seed-e2e-journey.ts [--apply --i-know-prod]
// Env: ADMIN_API_DATABASE_URL (‖ DATABASE_URL), HUB_DATABASE_URL (‖ DATABASE_URL), E2E_JOURNEY_PW.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN } from "@ai/contracts";
import { createDb, type Db, hashPassword, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { runSeed, type SeedReport } from "./seed-niti";
import type { Person, RuleSpec, SeedSpec } from "./seed-niti.data";
import { applyGuard } from "./seed-niti.rules";

/** Tiền tố BẮT BUỘC của khoá tenant (và quy trình thư viện) do seed này tạo/đụng tới. */
export const JOURNEY_PREFIX = "e2e-";
export const JOURNEY_TENANT = { key: "e2e-approval", name: "E2E Approval Journey" } as const;

const KD = { key: "pb-kinh-doanh", vi: "Phòng Kinh doanh", en: "Sales" };
const KT = { key: "pb-ke-toan", vi: "Phòng Kế toán", en: "Accounting" };
const BGD = { key: "pb-giam-doc", vi: "Ban Giám đốc", en: "Board of Directors" };

const person = (
  username: string,
  display: string,
  dept: string,
  head: boolean,
  admin = false,
): Person => ({
  username,
  display,
  title: display,
  dept,
  head,
  role: admin ? "tenant_admin" : "member",
  packRole: admin ? "owner" : "editor",
});

/** Người dùng của hành trình (vai nghiệp vụ → tên đăng nhập). */
export const JOURNEY_USERS = {
  /** Nhân viên Phòng Kinh doanh — người tải HĐ lên và bấm "Xác nhận và lưu". */
  employee: "e2e-kd-nv",
  /** Trưởng Phòng Kế toán — người duyệt bước 1 của quy trình Mua. */
  accounting: "e2e-ketoan",
  /** Trưởng Ban Giám đốc — người duyệt bước 2 (Mua) / duy nhất (Bán). */
  director: "e2e-giamdoc",
} as const;

/** Hai quy trình thư viện (khoá `e2e-`): Mua = Kế toán → Giám đốc; Bán = Giám đốc. */
export const JOURNEY_PROCESSES = {
  buy: { key: "e2e-mua-kd", name: "E2E Mua (Kinh doanh)" },
  sell: { key: "e2e-ban-kd", name: "E2E Bán (Kinh doanh)" },
} as const;

/** Luật chọn quy trình platform admin đặt ở ai-admin: phòng × loại HĐ (cùng hình `RuleSpec` của seed-niti). */
export const JOURNEY_RULES: RuleSpec[] = [
  { dept: KD.key, kind: "buy", process: JOURNEY_PROCESSES.buy.key },
  { dept: KD.key, kind: "sell", process: JOURNEY_PROCESSES.sell.key },
];

export const JOURNEY_SPEC: SeedSpec = {
  tenantKey: JOURNEY_TENANT.key,
  tenantName: JOURNEY_TENANT.name,
  timezone: "Asia/Ho_Chi_Minh",
  emailDomain: "e2e-approval.example.invalid",
  packs: ["contracts"],
  root: BGD,
  departments: [KD, KT],
  people: [
    person(JOURNEY_USERS.director, "E2E Giám đốc", BGD.key, true, true),
    person(JOURNEY_USERS.accounting, "E2E Trưởng phòng Kế toán", KT.key, true),
    person("e2e-kd-truong", "E2E Trưởng phòng Kinh doanh", KD.key, true),
    person(JOURNEY_USERS.employee, "E2E Nhân viên Kinh doanh", KD.key, false),
  ],
  processes: [
    {
      ...JOURNEY_PROCESSES.buy,
      steps: [
        { key: "ke-toan", name: "Phòng Kế toán duyệt", dept: KT.key },
        { key: "giam-doc", name: "Ban Giám đốc duyệt", dept: BGD.key },
      ],
    },
    {
      ...JOURNEY_PROCESSES.sell,
      steps: [{ key: "giam-doc", name: "Ban Giám đốc duyệt", dept: BGD.key }],
    },
  ],
  rules: JOURNEY_RULES,
};

/** Lý do TỪ CHỐI (null = được). Thuần: khoá tenant phải bắt đầu `e2e-`, mọi quy trình cũng; mật khẩu đủ độ dài. */
export function journeyGuard(o: { spec: SeedSpec; pw: string | undefined }): string | null {
  if (!o.spec.tenantKey.startsWith(JOURNEY_PREFIX))
    return `khoá tenant "${o.spec.tenantKey}" không bắt đầu "${JOURNEY_PREFIX}" — không bao giờ đụng tenant thật`;
  const bad = o.spec.processes.find((p) => !p.key.startsWith(JOURNEY_PREFIX));
  if (bad) return `quy trình "${bad.key}" không bắt đầu "${JOURNEY_PREFIX}"`;
  const n = o.pw?.length ?? 0;
  if (n < PASSWORD_MIN_LEN || n > PASSWORD_MAX_LEN)
    return `cần E2E_JOURNEY_PW (${PASSWORD_MIN_LEN}–${PASSWORD_MAX_LEN} ký tự)`;
  return null;
}

/** Đặt mật khẩu cố định (không buộc đổi) cho MỌI user của tenant `e2e-*`; trả số user đã đặt. */
export async function setJourneyPasswords(
  admin: Db,
  tenantKey: string,
  pw: string,
): Promise<number> {
  if (!tenantKey.startsWith(JOURNEY_PREFIX))
    throw new Error("setJourneyPasswords: chỉ tenant e2e-*");
  const hash = await hashPassword(pw);
  return withScope(admin, { kind: "platform" }, async (tx) => {
    const r =
      (await tx.execute(sql`update admin.users u set password_hash = ${hash}, must_change_password = false
      from admin.tenants t where t.id = u.tenant_id and t.key = ${tenantKey} returning u.id`)) as unknown as unknown[];
    return r.length;
  });
}

/** Dựng tenant hành trình (idempotent). Mật khẩu tạm của seed-niti đi vào file tạm rồi xoá — mật khẩu thật là `pw`. */
export async function provisionJourneyTenant(
  admin: Db,
  hub: Db,
  o: { pw: string; log?: (s: string) => void },
): Promise<SeedReport> {
  const why = journeyGuard({ spec: JOURNEY_SPEC, pw: o.pw });
  if (why) throw new Error(`seed-e2e-journey: từ chối — ${why}`);
  const credFile = join(tmpdir(), `e2e-journey-cred-${process.pid}-${Date.now()}.txt`);
  try {
    const rep = await runSeed(admin, hub, JOURNEY_SPEC, {
      apply: true,
      credFile,
      routing: false,
      ...(o.log ? { log: o.log } : {}),
    });
    await setJourneyPasswords(admin, JOURNEY_SPEC.tenantKey, o.pw);
    return rep;
  } finally {
    rmSync(credFile, { force: true });
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const adminUrl = process.env.ADMIN_API_DATABASE_URL ?? process.env.DATABASE_URL;
  const hubUrl = process.env.HUB_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!adminUrl || !hubUrl)
    throw new Error(
      "seed-e2e-journey: cần ADMIN_API_DATABASE_URL/HUB_DATABASE_URL (hoặc DATABASE_URL)",
    );
  const why = applyGuard({
    apply: true,
    iKnowProd: argv.includes("--i-know-prod"),
    appEnv: process.env.APP_ENV,
    urls: [adminUrl, hubUrl],
  });
  if (why) throw new Error(`seed-e2e-journey: từ chối — ${why}`);
  const admin = createDb(adminUrl, { max: 2 });
  const hub = connectDb(hubUrl, 2);
  try {
    await provisionJourneyTenant(admin, hub, { pw: process.env.E2E_JOURNEY_PW ?? "" });
  } finally {
    await admin.close();
    await hub.close();
  }
}

if (import.meta.main) await main(process.argv.slice(2));
