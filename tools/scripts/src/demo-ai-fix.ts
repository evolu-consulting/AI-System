// Demo · AI System trả lời được về tệp + tri thức — CHỈ tenant `demo`, LẶP LẠI ĐƯỢC (chỉ thêm/sửa phần thiếu). Cần DATABASE_URL của
// chủ migration (siêu người dùng). Mặc định chạy thử (chỉ đếm việc sẽ làm); `--apply` mới ghi. Trên máy chủ:
//   docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/demo-ai-fix.ts --tenant demo [--apply]
// Việc làm: (1) cấp agent chung `assistant` (entitlement + grant y hệt các grant của `mgmt-assistant` trong tenant) để Điều phối
// đọc được tệp đính kèm; (2) một tài liệu tri thức giả nếu demo chưa có tài liệu nào; (3) đổi tên công ty còn là "NITI…" thành tên
// giả; (4) bù điện thoại + người liên hệ đối tác mẫu còn trống. KHÔNG đụng tenant khác (kiểm cả trong DB).
import { createHash } from "node:crypto";
import postgres from "postgres";
import { DEMO_KEY } from "./seed-demo-v2";
import { partyKeyOf } from "./seed-demo-v2.build";
import { OWN, PARTNERS } from "./seed-demo-v2.specs";

export function assertDemo(key: string | undefined): asserts key is typeof DEMO_KEY {
  if (key !== DEMO_KEY)
    throw new Error(`demo-ai-fix: chỉ chạy cho tenant "${DEMO_KEY}" — từ chối "${key ?? ""}"`);
}

export const DOC_TITLE = "Quy trình phê duyệt hợp đồng — Công ty Demo (dữ liệu giả)";
export const DOC_CHUNKS: readonly { heading: string; body: string }[] = [
  {
    heading: "Hạn mức phê duyệt",
    body: "Hợp đồng có giá trị dưới 50 triệu đồng do Trưởng phòng Kinh doanh phê duyệt. Từ 50 triệu đến 500 triệu đồng cần Kế toán trưởng xác nhận thêm. Trên 500 triệu đồng phải có chữ ký của Giám đốc Công ty Demo.",
  },
  {
    heading: "Thời hạn xử lý",
    body: "Mỗi bước phê duyệt xử lý trong tối đa 3 ngày làm việc. Hợp đồng gia hạn chữ ký số được nhắc trước 30 ngày khi hết hạn; hợp đồng dịch vụ khác nhắc trước 15 ngày.",
  },
  {
    heading: "Lưu trữ và đầu mối",
    body: "Bản gốc hợp đồng đã ký do Phòng Pháp chế lưu trong 10 năm. Đầu mối giải đáp quy trình là chị Ngô Thanh Mai, Phòng Pháp chế, số nội bộ 204.",
  },
];

export const docHash = (): string =>
  createHash("sha256")
    .update(DOC_TITLE + DOC_CHUNKS.map((c) => c.heading + c.body).join("\n"))
    .digest("hex");

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
export type Plan = {
  entitlement: boolean;
  grants: number;
  doc: boolean;
  company: boolean;
  partners: number;
};

async function plan(tx: Tx, t: string): Promise<Plan> {
  const [r] = await tx<
    { ent: boolean; grants: number; docs: number; company: boolean; partners: number }[]
  >`select
    not exists (select 1 from hub.agent_entitlements e join hub.agents a on a.id = e.agent_id
      where a.key = 'assistant' and e.tenant_id = ${t} and e.revoked_at is null) as ent,
    (select count(*)::int from hub.agent_grants g join hub.agents m on m.id = g.agent_id and m.key = 'mgmt-assistant'
      where g.tenant_id = ${t} and not exists (select 1 from hub.agent_grants x join hub.agents a on a.id = x.agent_id
        and a.key = 'assistant' where x.tenant_id = g.tenant_id and x.subject_type = g.subject_type and x.subject_id = g.subject_id)) as grants,
    (select count(*)::int from knowledge.documents where tenant_id = ${t}) as docs,
    exists (select 1 from contracts.company_settings where tenant_id = ${t} and company_name ilike '%niti%') as company,
    (select count(*)::int from contracts.companies where tenant_id = ${t} and (phone is null or contact_person is null)) as partners`;
  if (!r) throw new Error("demo-ai-fix: không đọc được hiện trạng");
  return {
    entitlement: r.ent,
    grants: r.grants,
    doc: r.docs === 0,
    company: r.company,
    partners: r.partners,
  };
}

async function apply(tx: Tx, t: string, p: Plan): Promise<void> {
  const [v] = await tx<
    { v: number }[]
  >`update hub.config_meta set hub_config_version = hub_config_version + 1
    where id = 1 returning hub_config_version as v`;
  await tx`insert into hub.agent_entitlements (agent_id, tenant_id)
    select id, ${t}::uuid from hub.agents where key = 'assistant' on conflict (agent_id, tenant_id) do update set revoked_at = null`;
  await tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
    select a.id, g.tenant_id, g.subject_type, g.subject_id from hub.agent_grants g
      join hub.agents m on m.id = g.agent_id and m.key = 'mgmt-assistant', hub.agents a
    where g.tenant_id = ${t} and a.key = 'assistant'
    on conflict (agent_id, tenant_id, subject_type, subject_id) do nothing`;
  await tx`select pg_notify('hub_config_changed', ${JSON.stringify({ v: 1, version: v?.v })})`;
  if (p.doc) {
    await tx`select set_config('app.tenant_id', ${t}, true)`;
    const [d] = await tx<
      { id: string }[]
    >`insert into knowledge.documents (tenant_id, title, kind, source, content_hash, chunk_count)
      values (${t}, ${DOC_TITLE}, 'markdown', 'demo-seed', ${docHash()}, ${DOC_CHUNKS.length})
      on conflict (tenant_id, content_hash) do nothing returning id`;
    if (d)
      for (const [i, c] of DOC_CHUNKS.entries())
        await tx`insert into knowledge.chunks (tenant_id, doc_id, ord, heading, body) values (${t}, ${d.id}, ${i}, ${c.heading}, ${c.body})`;
  }
  await tx`update contracts.company_settings set company_name = ${OWN.name}, own_names = ${[OWN.name]}::text[]
    where tenant_id = ${t} and company_name ilike '%niti%'`;
  for (const x of PARTNERS)
    if (x.phone)
      await tx`update contracts.companies set phone = coalesce(phone, ${x.phone}), contact_person = coalesce(contact_person, ${x.contact ?? null})
        where tenant_id = ${t} and party_key = ${partyKeyOf(x.key)}`;
}

export async function run(sql: Sql, doApply: boolean): Promise<Plan> {
  return sql.begin(async (tx) => {
    const [t] = await tx<
      { id: string; key: string }[]
    >`select id, key from admin.tenants where key = ${DEMO_KEY}`;
    if (!t) throw new Error(`demo-ai-fix: không có tenant "${DEMO_KEY}"`);
    assertDemo(t.key);
    const p = await plan(tx, t.id);
    if (doApply) await apply(tx, t.id, p);
    return p;
  });
}

async function main(argv: readonly string[]): Promise<void> {
  const i = argv.indexOf("--tenant");
  assertDemo(i >= 0 ? argv[i + 1] : undefined);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("demo-ai-fix: cần DATABASE_URL (chủ migration)");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [r] = await sql<
      { su: boolean }[]
    >`select rolsuper as su from pg_roles where rolname = current_user`;
    if (!r?.su) throw new Error("demo-ai-fix: cần vai siêu người dùng (chủ migration)");
    const apply = argv.includes("--apply");
    console.log(
      `demo-ai-fix: ${apply ? "ĐÃ ÁP DỤNG" : "chạy thử (thêm --apply để ghi)"} — việc cần làm trước khi chạy:`,
      await run(sql, apply),
    );
  } finally {
    await sql.end();
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
