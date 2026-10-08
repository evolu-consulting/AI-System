// CR-051 · `bun run db:reset:dev -- --yes`: xoá sạch DB dev (mọi hội thoại, phòng, tenant) rồi tạo lại rỗng; sau đó chạy
// `db:setup` + `hub:dev` để migrate và seed lại (platform + evolu). Chỉ chạy khi APP_ENV=development, DB đích không phải DB
// test (`*_test*`) và có cờ `--yes`. Lỗi chỉ nêu tên biến/DB, không in URL.
import postgres from "postgres";
import { describeError } from "./migrate";
import { withDatabase } from "./test-db";

export function resetTarget(env: Record<string, string | undefined>, argv: string[]): string {
  if (env.APP_ENV !== "development") throw new Error("chỉ chạy với APP_ENV=development");
  if (!argv.includes("--yes")) throw new Error("thiếu cờ --yes (xoá dữ liệu không khôi phục được)");
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL chưa đặt");
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!name || name === "postgres" || name.includes("_test"))
    throw new Error(`DB đích không hợp lệ: ${name}`);
  return name;
}

if (import.meta.main) {
  try {
    const name = resetTarget(process.env, process.argv.slice(2));
    const url = process.env.DATABASE_URL as string;
    const sql = postgres(withDatabase(url, "postgres"), { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await sql.unsafe(`CREATE DATABASE "${name}"`);
    } finally {
      await sql.end();
    }
    console.log(`db:reset:dev OK: ${name} đã tạo lại rỗng — chạy tiếp db:setup`);
  } catch (err) {
    console.error(`db:reset:dev lỗi: ${describeError(err)}`);
    process.exit(1);
  }
}
