// I1 · chuẩn bị Postgres đích của bản sao evotest-mgmt (role chủ — CHỈ DB tạm của lượt chạy, chỉ đọc): in id actor platform admin cho in-runner.sh.
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: () => {} });
try {
  const [a] = await sql<
    { id: string }[]
  >`select id from admin.users where role = 'platform_admin' and active order by created_at limit 1`;
  if (!a) throw new Error("NO_PLATFORM_ADMIN");
  process.stdout.write(a.id);
} finally {
  await sql.end();
}
