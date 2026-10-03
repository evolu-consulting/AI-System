// ADM-FR-55 · M3-R21, R22, R24 · ConflictDialog · chuỗi giao diện song ngữ VI/EN của M3 (test-plan C1; plan-frontend §5, §7). Không DB.
// Bảng cố định từ plan-frontend §7 (nhóm theo tiền tố key); xanh ở FE0. `bun run i18n:check` chạy riêng ở lệnh xong.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_modules";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const load = (lang: string): Record<string, string> =>
  flatten(
    JSON.parse(readFileSync(join(ROOT, `packages/i18n/locales/${lang}.json`), "utf8")) as Tree,
  );

type Row = [string, string, string];
const TABLE: Row[] = [
  ["conflict.title", "Có người vừa lưu bản mới hơn", "Someone just saved a newer version"],
  [
    "conflict.body.byUser",
    "{user} vừa sửa {entity} này lúc {time} (v{n}). Bản của bạn dựa trên v{mine}.",
    "{user} edited this {entity} at {time} (v{n}). Your copy is based on v{mine}.",
  ],
  [
    "conflict.body.anon",
    "Bản này vừa được sửa lúc {time} (v{n}). Bản của bạn dựa trên v{mine}.",
    "This was just edited at {time} (v{n}). Your copy is based on v{mine}.",
  ],
  ["conflict.entity.user", "user", "user"],
  ["conflict.entity.tenant", "tenant", "tenant"],
  ["conflict.entity.workflow", "workflow", "workflow"],
  ["conflict.entity.command", "command", "command"],
  ["conflict.entity.feature", "feature", "feature"],
  ["conflict.entity.group", "group", "group"],
  ["conflict.action.diff", "Xem khác biệt", "View differences"],
  ["conflict.action.overwrite", "Ghi đè", "Overwrite"],
  ["conflict.action.reload", "Tải bản mới", "Load latest"],
  [
    "conflict.diff.aria",
    "Khác biệt giữa bản của bạn và bản mới nhất",
    "Differences between your version and the latest",
  ],
  ["conflict.diff.field", "Trường", "Field"],
  ["conflict.diff.mine", "Bản của bạn", "Your version"],
  ["conflict.diff.latest", "Bản mới nhất (v{n})", "Latest (v{n})"],
  [
    "conflict.diff.empty",
    "Không có trường nào khác nhau. Có thể người kia chỉ lưu lại bản cũ.",
    "No fields differ. The other person may have just re-saved.",
  ],
  ["conflict.diff.more", "Còn {n} trường khác", "{n} more fields"],
  ["conflict.diff.none", "(trống)", "(empty)"],
  ["conflict.overwrite.titleUser", "Ghi đè thay đổi của {user}?", "Overwrite {user}'s changes?"],
  ["conflict.overwrite.titleAnon", "Ghi đè thay đổi mới nhất?", "Overwrite the latest changes?"],
  [
    "conflict.overwrite.body",
    "Bản v{n} sẽ bị thay bằng bản của bạn (thành v{next}).",
    "v{n} will be replaced by your version (becoming v{next}).",
  ],
  ["conflict.toast.loaded", "Đã tải bản mới nhất · v{n}", "Loaded latest · v{n}"],
];

/** Nhãn e2e (plan-frontend §5) phải là giá trị ĐẦY ĐỦ của một key trong vi.json (khớp từng ký tự). */
const E2E_LABELS = [
  "Có người vừa lưu bản mới hơn",
  "Xem khác biệt",
  "Ghi đè",
  "Tải bản mới",
  "Ghi đè thay đổi mới nhất?",
  "Khác biệt giữa bản của bạn và bản mới nhất",
  "Trường",
  "Bản của bạn",
];

describe("ADM-FR-55 · M3-R24 · i18n VI/EN (conflict)", () => {
  it("ADM-FR-55 · M3-R24 · vi.json và en.json có cùng tập key", () => {
    const vi = Object.keys(load("vi")).sort();
    const en = Object.keys(load("en")).sort();
    expect(en).toEqual(vi);
  });

  it("ADM-FR-55 · M3-R24 · mọi key nhóm conflict (plan-frontend §7) có giá trị VI và EN nguyên văn", () => {
    const vi = load("vi");
    const en = load("en");
    const wrong: string[] = [];
    for (const [key, viText, enText] of TABLE) {
      if (vi[key] !== viText) wrong.push(`vi.${key}`);
      if (en[key] !== enText) wrong.push(`en.${key}`);
    }
    expect(wrong).toEqual([]);
  });

  it("ADM-FR-55 · M3-R24 · nhãn e2e nhóm conflict xuất hiện làm giá trị đầy đủ trong vi.json", () => {
    const set = new Set(Object.values(load("vi")));
    expect(E2E_LABELS.filter((l) => !set.has(l))).toEqual([]);
  });

  it("ADM-FR-55 · M3-R22 · M4-R17 · 'Lịch sử' chỉ ở conflict.overwrite.history (M4 có audit: vi 'Lịch sử vẫn giữ v{n}.', en 'History keeps v{n}.'); có đủ câu có {user} và không {user} (R21) ở cả hai locale", () => {
    for (const lang of ["vi", "en"] as const) {
      const all = load(lang);
      const conflict = Object.entries(all).filter(([k]) => k.startsWith("conflict."));
      expect(conflict.length).toBeGreaterThan(0);
      // M4 (Q2a, test-plan §5 K8): câu lịch sử quay lại khi đã có audit (plan-frontend §7).
      expect(conflict.filter(([, v]) => /Lịch sử|history/i.test(v)).map(([k]) => k)).toEqual([
        "conflict.overwrite.history",
      ]);
      expect(all["conflict.overwrite.history"]).toBe(
        lang === "vi" ? "Lịch sử vẫn giữ v{n}." : "History keeps v{n}.",
      );
      expect(all["conflict.body.byUser"]).toContain("{user}");
      expect(all["conflict.body.anon"]).not.toContain("{user}");
      expect(all["conflict.overwrite.titleUser"]).toContain("{user}");
      expect(all["conflict.overwrite.titleAnon"]).not.toContain("{user}");
    }
  });
});
