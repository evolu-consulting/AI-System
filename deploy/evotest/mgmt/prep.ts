// I1 · chuẩn bị Postgres đích của bản sao evotest-mgmt (role chủ — CHỈ DB tạm của lượt chạy, chỉ đọc): in "<actor platform admin> <org của tài liệu tri thức chung>" cho in-runner.sh.
// Org tri thức = org của chủ demo (membership `MGMT_KNOWLEDGE_OWNER`, mặc định tien@annam.test) — mgmt-app không gắn org cho tài liệu chung.
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: () => {} });
try {
  const [a] = await sql<
    { id: string }[]
  >`select id from admin.users where role = 'platform_admin' and active order by created_at limit 1`;
  if (!a) throw new Error("NO_PLATFORM_ADMIN");
  const owner = process.env.MGMT_KNOWLEDGE_OWNER ?? "tien@annam.test";
  const os = process.env.MGMT_OPENSEARCH_URL ?? "http://mgmt-opensearch:9200";
  const r = await fetch(`${os}/memberships/_doc/${encodeURIComponent(owner)}`);
  const org = r.ok
    ? ((await r.json()) as { _source?: { org_id?: string } })._source?.org_id
    : undefined;
  process.stdout.write(`${a.id} ${org ?? ""}`);
} finally {
  await sql.end();
}
