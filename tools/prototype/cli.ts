// Phần chung của các lệnh proto:*: đọc + kiểm <thư-mục>/prototype.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPrototype } from "./check.rules";
import { type Prototype, prototypeSchema } from "./schema";

export function fail(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

export function loadPrototype(dir: string | undefined, usage: string): Prototype {
  if (!dir) fail(`Cách dùng: ${usage}`, 2);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, "prototype.json"), "utf8"));
  } catch (e) {
    fail(
      `Không đọc được ${join(dir, "prototype.json")}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const r = prototypeSchema.safeParse(raw);
  if (!r.success)
    fail(
      `Bản mẫu sai:\n${r.error.issues.map((i) => `- ${i.path.join(".") || "$"}: ${i.message}`).join("\n")}`,
    );
  return r.data;
}

/** Như loadPrototype, kèm kiểm số màn hình + từ kỹ thuật; cảnh báo in ra, lỗi thì dừng. */
export function loadChecked(dir: string | undefined, usage: string): Prototype {
  const p = loadPrototype(dir, usage);
  const c = checkPrototype(p);
  for (const w of c.warnings) console.warn(`Cảnh báo: ${w}`);
  if (c.errors.length) fail(`Bản mẫu chưa đạt:\n${c.errors.map((e) => `- ${e}`).join("\n")}`);
  return p;
}
