// Demo · dọn dữ liệu e2e triển khai còn sót — CHỈ tenant `demo`. Mặc định chạy thử (in danh sách); `--apply` mới xoá. Trên máy chủ:
//   docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/demo-e2e-sweep.ts --tenant demo [--apply]
// Xoá: Group "E2E-DEPLOY …" KHÔNG còn thành viên (kéo theo quyền admin.feature_grants + dấu phòng ban qua FK cascade) và
// hub.agent_grants của Group đó; góp ý (admin.feedback) và hội thoại (hub.conversations, xoá mềm) gắn thẻ E2E-DEPLOY.
// Hợp đồng gắn thẻ chỉ LIỆT KÊ (nhiều bảng con; e2e tự xoá qua giao diện). Cần DATABASE_URL của chủ migration.
import postgres from "postgres";

export const DEMO_KEY = "demo";
export const TAG = "E2E-DEPLOY";

export function assertDemo(key: string | undefined): asserts key is typeof DEMO_KEY {
  if (key !== DEMO_KEY)
    throw new Error(`demo-e2e-sweep: chỉ chạy cho tenant "${DEMO_KEY}" — từ chối "${key ?? ""}"`);
}

/** Tên có gắn thẻ e2e (đầu chuỗi, không phân biệt hoa thường). */
export const isTagged = (s: string): boolean => s.trim().toUpperCase().startsWith(TAG);

type Sql = postgres.Sql;
export type Found = {
  groups: { id: string; key: string; members: number }[];
  feedback: number;
  conversations: number;
  contracts: { id: string; title: string }[];
};

const like = `${TAG}%`;

export async function find(sql: Sql, tenant: string): Promise<Found> {
  const groups = await sql<{ id: string; key: string; members: number }[]>`
    select g.id, g.key, (select count(*)::int from admin.group_members m
        where m.group_id = g.id and m.tenant_id = g.tenant_id) as members
      from admin.groups g
      where g.tenant_id = ${tenant} and (g.key ilike ${`e2e-deploy%`} or g.name->>'vi' ilike ${like})
      order by g.key`;
  const [f] = await sql<{ n: number }[]>`select count(*)::int as n from admin.feedback
    where tenant_id = ${tenant} and message ilike ${like}`;
  const [c] = await sql<{ n: number }[]>`select count(*)::int as n from hub.conversations
    where tenant_id = ${tenant} and deleted_at is null and title ilike ${like}`;
  const contracts = await sql<
    { id: string; title: string }[]
  >`select id, title from contracts.contracts
    where tenant_id = ${tenant} and title ilike ${like}`;
  return { groups, feedback: f?.n ?? 0, conversations: c?.n ?? 0, contracts };
}

export async function apply(sql: Sql, tenant: string, found: Found): Promise<void> {
  const ids = found.groups.filter((g) => g.members === 0).map((g) => g.id);
  await sql.begin(async (tx) => {
    if (ids.length > 0) {
      await tx`delete from hub.agent_grants where tenant_id = ${tenant}
        and subject_type = 'group' and subject_id::text in ${tx(ids)}`;
      // Còn 0 thành viên lúc xoá (điều kiện trong câu lệnh, chống đua).
      await tx`delete from admin.groups g where g.tenant_id = ${tenant} and g.id in ${tx(ids)}
        and not exists (select 1 from admin.group_members m where m.group_id = g.id and m.tenant_id = g.tenant_id)`;
    }
    await tx`delete from admin.feedback where tenant_id = ${tenant} and message ilike ${like}`;
    await tx`update hub.conversations set deleted_at = now()
      where tenant_id = ${tenant} and deleted_at is null and title ilike ${like}`;
  });
}

async function main(argv: readonly string[]): Promise<void> {
  const i = argv.indexOf("--tenant");
  assertDemo(i >= 0 ? argv[i + 1] : undefined);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("demo-e2e-sweep: cần DATABASE_URL (chủ migration)");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [t] = await sql<{ id: string }[]>`select id from admin.tenants where key = ${DEMO_KEY}`;
    if (!t) throw new Error(`demo-e2e-sweep: không thấy tenant "${DEMO_KEY}"`);
    const found = await find(sql, t.id);
    const doIt = argv.includes("--apply");
    const skip = found.groups.filter((g) => g.members > 0);
    console.log(`demo-e2e-sweep: ${doIt ? "ĐÃ ÁP DỤNG" : "chạy thử (thêm --apply để xoá)"}`);
    for (const g of found.groups)
      console.log(`  group ${g.key} (${g.members} thành viên)${g.members > 0 ? " — BỎ QUA" : ""}`);
    console.log(
      `  góp ý: ${found.feedback} · hội thoại: ${found.conversations} · hợp đồng (chỉ liệt kê): ${found.contracts.length}`,
    );
    for (const c of found.contracts) console.log(`  hợp đồng ${c.id} ${c.title}`);
    console.log(`  tổng group xoá: ${found.groups.length - skip.length}`);
    if (doIt) await apply(sql, t.id, found);
  } finally {
    await sql.end();
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
