// CR-125 c3 · `bun run check:settings-path`: chuỗi locale nhắc đường dẫn "Cài đặt › X" / "Công ty › X" (vi) hay "Settings › X" / "Company › X" (en)
// phải trỏ tới nhãn mục CÓ THẬT: Cài đặt app Hợp đồng = `contracts.settings.sec.*`; Công ty (Admin) = `tenants.tab.*`. Dấu phân cách chuẩn là "›".
// Nên ghi đường dẫn bằng token `{{path:<mục>}}` (settings-paths.ts) thay vì gõ tay.
import { settingsSectionKeys } from "../../../packages/i18n/src/settings-paths";
import { repoRoot } from "./lib/git";
import { type LocaleEntry, readLocaleEntries } from "./lib/locale-files";

export type RootLabels = Record<string, string[]>; // nhãn gốc ("Cài đặt") → các nhãn mục hợp lệ
export type Finding = { file: string; key: string; text: string; why: string };

// Gốc đường dẫn + dấu phân cách bất kỳ (› hoặc >) + phần còn lại của câu.
const REF = /(Cài đặt|Công ty|Settings|Company)\s*([›>])\s*([^\n]*)/g;

/** Hàm thuần: kiểm một giá trị với bảng nhãn hợp lệ theo ngôn ngữ. */
export function pathProblems(value: string, labels: RootLabels): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(REF)) {
    const [, root = "", sep = "", rest = ""] = m;
    const valid = labels[root];
    if (!valid) continue;
    if (sep !== "›") out.push(`"${m[0].slice(0, 40)}" dùng dấu "${sep}" — dùng "›"`);
    if (!valid.some((l) => rest.startsWith(l)))
      out.push(`"${root} › ${rest.slice(0, 24)}…" không khớp mục nào (${valid.join(" | ")})`);
  }
  return out;
}

/** Nhãn hợp lệ theo ngôn ngữ, đọc từ chính file locale (không chép tay). */
export function loadLabels(entries: LocaleEntry[], lang: "vi" | "en"): RootLabels {
  const val = (key: string): string[] => {
    const hits = entries.filter((e) => e.lang === lang && e.key === key);
    return hits.map((h) => h.value);
  };
  const secs = settingsSectionKeys().flatMap((k) => val(`contracts.settings.sec.${k}`));
  const tabs = ["profile", "apps", "processes", "members", "settings"].flatMap((k) =>
    val(`tenants.tab.${k}`),
  );
  const settingsRoot = val("contracts.settings.title")[0] ?? "";
  const companyRoot = lang === "vi" ? "Công ty" : "Company";
  return { [settingsRoot]: secs, [companyRoot]: tabs };
}

export function checkSettingsPath(root: string): Finding[] {
  const entries = readLocaleEntries(root);
  const labels = { vi: loadLabels(entries, "vi"), en: loadLabels(entries, "en") };
  return entries.flatMap((e) =>
    pathProblems(e.value, labels[e.lang]).map((why) => ({
      file: e.file,
      key: e.key,
      text: e.value,
      why,
    })),
  );
}

function main(): number {
  const bad = checkSettingsPath(repoRoot());
  for (const f of bad) console.error(`settings-path: ${f.file} ${f.key} — ${f.why}`);
  console.log(bad.length === 0 ? "settings-path: sạch" : `settings-path: ${bad.length} vi phạm`);
  return bad.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
