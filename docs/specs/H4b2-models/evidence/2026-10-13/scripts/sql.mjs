// psql qua docker exec (DB dev ai_system) — chỉ dùng chuẩn bị trạng thái provider_state / đọc dữ liệu kiểm chứng
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const env = readFileSync("D:/AI/ai-system/.env.local", "utf8");
const url = /^DATABASE_URL=(.*)$/m.exec(env)[1].trim();
export const sql = (q) => execFileSync("docker", ["exec", "ai-system-postgres-1", "psql", url, "-At", "-c", q], { encoding: "utf8" }).trim();
