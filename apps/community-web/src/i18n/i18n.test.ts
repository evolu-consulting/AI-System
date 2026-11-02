// COM-FR-46 · chọn ngôn ngữ, bộ nạp bản dịch, thiếu EN ⇒ VI, key dùng trong mã có trong bản VI.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadCommunityLocale } from "@ai/i18n/community-locales";
import { i18n, isLocale, pickLocale, setLang, t } from "./index";

const SRC = join(import.meta.dir, "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const flat = (o: unknown, pre = ""): string[] =>
  typeof o === "object" && o !== null
    ? Object.entries(o).flatMap(([k, v]) => flat(v, pre ? `${pre}.${k}` : k))
    : [pre];

describe("pickLocale", () => {
  test("đã lưu thắng /me; /me thắng mặc định; giá trị lạ bỏ qua; mặc định vi", () => {
    expect(pickLocale({ stored: "en", me: "vi" })).toBe("en");
    expect(pickLocale({ stored: null, me: "en" })).toBe("en");
    expect(pickLocale({ stored: "fr", me: "de" })).toBe("vi");
    expect(pickLocale({})).toBe("vi");
    expect(isLocale("en") && !isLocale("fr")).toBe(true);
  });
});

describe("loader + t", () => {
  test("vi và en cùng tập key, mọi giá trị không rỗng", async () => {
    const vi = await loadCommunityLocale("vi");
    const en = await loadCommunityLocale("en");
    expect(flat(vi).sort()).toEqual(flat(en).sort());
    expect(flat(vi).every((k) => k.startsWith("community."))).toBe(true);
  });

  test("mặc định vi; đổi sang en nạp bản dịch; thiếu key EN ⇒ rơi về VI", async () => {
    expect(t("community.feed.tabs.sell")).toBe("Cần bán");
    await setLang("en", false);
    expect(t("community.feed.tabs.sell")).toBe("Selling");
    i18n.addResource("vi", "translation", "community.only.vi", "Chỉ có VI");
    expect(t("community.only.vi")).toBe("Chỉ có VI");
    await setLang("vi", false);
    expect(t("community.feed.tabs.sell")).toBe("Cần bán");
  });

  test('mọi key literal t("community.…") trong mã đều có trong bản VI', async () => {
    const keys = new Set(flat(await loadCommunityLocale("vi")));
    const missing: string[] = [];
    for (const f of walk(SRC).filter((p) => /\.tsx?$/.test(p) && !p.endsWith(".test.ts"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bt\(\s*"(community\.[\w.]+)"/g)) {
        if (!keys.has(m[1] as string)) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
