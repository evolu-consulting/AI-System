// app-guide · nạp nội dung gói sẵn trong repo (`content/*.md`, chạy từ mã nguồn bằng bun) một lần; không DB, không dữ liệu tenant.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type GuideSection, parseGuideDoc } from "./guide.rules";

const DIR = join(import.meta.dir, "content");

let cache: readonly GuideSection[] | undefined;

export function loadGuide(): readonly GuideSection[] {
  cache ??= readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .flatMap((f) => parseGuideDoc(readFileSync(join(DIR, f), "utf8")));
  return cache;
}
