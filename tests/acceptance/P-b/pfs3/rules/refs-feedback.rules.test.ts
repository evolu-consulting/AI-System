// P-b · CR-060 · vòng soát sau-UAT (reviewer Major #2) · HUB-FR-123 · PB-R09 · C16 · PB-R21 · RFB-01…RFB-12 (test-plan §4.3b).
// Feedback cho agent khi `## Nguồn tham chiếu` sai: `explainSourceRefs` (kèm `offenders`), `refCheckMessage` (thông điệp
// theo reason), `stage-sources.ts` `stageRefsExplain`/`refsFeedback` (gộp files_read nhiều nguồn, null ⇒ bỏ kiểm path).
// Hàm thuần; tra theo TÊN (import động) như `sources.rules.test.ts` — thiếu export ⇒ đỏ ở `expect`.
import { describe, expect, it } from "bun:test";

// biome-ignore lint/suspicious/noExplicitAny: tra theo tên
type Fn = (...a: any[]) => any;
const RUNS = "../../../../../apps/hub-api/src/modules/processes/runs";
const rules = (await import(`${RUNS}/sources.rules`)) as Record<string, unknown>;
const stage = (await import(`${RUNS}/stage-sources`)) as Record<string, unknown>;
function fn(mod: Record<string, unknown>, name: string): Fn {
  expect({ [name]: typeof mod[name] }).toEqual({ [name]: "function" });
  return mod[name] as Fn;
}
const explain = (...a: unknown[]) => fn(rules, "explainSourceRefs")(...a);
const message = (...a: unknown[]) => fn(rules, "refCheckMessage")(...a);
const check = (...a: unknown[]) => fn(rules, "checkSourceRefs")(...a);

const C1 = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const C2 = "b2c3d4e5f60718293a4b5c6d7e8f901234567890";
const LIB_V = "c3c3c3c3-0000-4000-8000-000000000001";
const SNAP = "d4d4d4d4-0000-4000-8000-000000000002";
const SECRET_PATH = "/qc-roots/pb-docs-bi-mat";
const PINS = {
  "app-repo": { kind: "git_remote", url: "https://github.com/pb-test/app-repo.git", sha: C1 },
  "quy-dinh": {
    kind: "library",
    document_id: "c3c3c3c3-0000-4000-8000-0000000000aa",
    version: LIB_V,
  },
  "noi-bo": { kind: "local_path", path: SECRET_PATH, snapshot_id: SNAP },
};
const KEYS = ["app-repo", "quy-dinh", "noi-bo"];
const md = (...lines: string[]) =>
  `# Báo cáo\n\nNội dung.\n\n## Nguồn tham chiếu\n${lines.join("\n")}\n`;

describe("RFB-01…05 · explainSourceRefs kèm offenders [PB-R09, HUB-FR-123, C16]", () => {
  it("PB-R09 · RFB-01 · unknown_key ⇒ offenders = các key lạ (khử trùng), không gồm key hợp lệ", () => {
    const text = md(`la:a.md@${C1}`, `la:b.md@${C1}`, `khac:c.md@${C1}`, `app-repo:src/a.ts@${C1}`);
    expect(explain(text, KEYS, PINS)).toEqual({
      ok: false,
      reason: "unknown_key",
      offenders: ["la", "khac"],
    });
  });
  it("PB-R09 · RFB-02 · version_mismatch ⇒ offenders = key sai @version (git sha, library version, local snapshot_id)", () => {
    const text = md(
      `app-repo:src/a.ts@${C2}`,
      `quy-dinh:qd.md@${LIB_V}`,
      "noi-bo:x.md@sai-snapshot",
    );
    expect(explain(text, KEYS, PINS)).toEqual({
      ok: false,
      reason: "version_mismatch",
      offenders: ["app-repo", "noi-bo"],
    });
  });
  it("PB-R09 · C16 · RFB-03 · path_absent ⇒ offenders = path chưa đọc (khử trùng, giữ thứ tự)", () => {
    const text = md(
      `app-repo:src/b.ts@${C1}`,
      `app-repo:src/a.ts@${C1}`,
      `app-repo:src/b.ts@${C1}`,
      `quy-dinh:qd.md@${LIB_V}`,
    );
    expect(explain(text, KEYS, PINS, ["src/a.ts", "qd.md"])).toEqual({
      ok: false,
      reason: "path_absent",
      offenders: ["src/b.ts"],
    });
  });
  it("PB-R09 · RFB-04 · dòng có tiền tố danh sách (`-`, `*`, `1.`, `2)`) vẫn hợp lệ ⇒ ok", () => {
    const text = md(
      `- app-repo:src/a.ts@${C1}`,
      `* quy-dinh:qd.md@${LIB_V}`,
      `1. noi-bo:x.md@${SNAP}`,
      `2) app-repo:b.ts@${C1}`,
    );
    expect(explain(text, KEYS, PINS, ["src/a.ts", "qd.md", "x.md", "b.ts"])).toEqual({ ok: true });
  });
  it("PB-R09 · RFB-05 · checkSourceRefs cùng reason với explain nhưng KHÔNG mang offenders", () => {
    const text = md(`la:a.md@${C1}`);
    expect(check(text, KEYS, PINS)).toEqual({ ok: false, reason: "unknown_key" });
  });
});

describe("RFB-06…09 · refCheckMessage theo reason [PB-R09, PB-R21]", () => {
  it("PB-R09 · RFB-06 · path_absent ⇒ nêu đủ path chưa đọc + nhắc chỉ trích file đã đọc ở bước này", () => {
    const m: string = message(
      { ok: false, reason: "path_absent", offenders: ["src/b.ts", "docs/c.md"] },
      PINS,
    );
    expect(m).toContain("## Nguồn tham chiếu");
    expect(m).toContain("src/b.ts");
    expect(m).toContain("docs/c.md");
  });
  it("PB-R09 · RFB-07 · unknown_key ⇒ nêu key lạ", () => {
    const m: string = message({ ok: false, reason: "unknown_key", offenders: ["la"] }, PINS);
    expect(m).toContain("## Nguồn tham chiếu");
    expect(m).toContain("la");
  });
  it("PB-R09 · PB-R21 · RFB-08 · version_mismatch ⇒ chỉ đúng `key@pin` (sha/snapshot_id), KHÔNG lộ đường dẫn local", () => {
    const m: string = message(
      { ok: false, reason: "version_mismatch", offenders: ["app-repo", "noi-bo"] },
      PINS,
    );
    expect(m).toContain(`app-repo@${C1}`);
    expect(m).toContain(`noi-bo@${SNAP}`);
    expect(m).not.toContain(SECRET_PATH);
    expect(m).not.toContain("https://");
  });
  it("PB-R09 · RFB-09 · missing vs empty ⇒ hai thông điệp khác nhau, đều nêu heading; empty nêu dạng key:đường/dẫn@version", () => {
    const miss: string = message({ ok: false, reason: "missing" }, PINS);
    const empty: string = message({ ok: false, reason: "empty" }, PINS);
    expect(miss).toContain("## Nguồn tham chiếu");
    expect(empty).toContain("## Nguồn tham chiếu");
    expect(empty).not.toBe(miss);
    expect(empty).toMatch(/key:[^\s@]+@version/);
  });
});

// ---------- stage-sources.ts ----------
const ctx = (keys: string[]) => ({
  idx: 0,
  stageSources: keys.map((k) => ({ source_key: k, allowlist: [] })),
  defSources: [],
  pinned: null,
  pins: PINS,
});
const feedback = (...a: unknown[]) => fn(stage, "refsFeedback")(...a);
const stageExplain = (...a: unknown[]) => fn(stage, "stageRefsExplain")(...a);
const HEAD = "## Nguồn tham chiếu";

describe("RFB-10…12 · stage-sources refsFeedback / stageRefsExplain [PB-R09, C16, C18]", () => {
  it("C16 · C18 · RFB-10 · files_read gộp NHIỀU nguồn; một nguồn files_read=null ⇒ bỏ kiểm path", () => {
    const text = md(`app-repo:src/a.ts@${C1}`, `quy-dinh:qd.md@${LIB_V}`);
    const c = ctx(["app-repo", "quy-dinh"]);
    const both = [
      { source_key: "app-repo", files_read: ["src/a.ts"] },
      { source_key: "quy-dinh", files_read: ["qd.md"] },
    ];
    expect(stageExplain(c, text, both)).toEqual({ ok: true });
    const miss = [both[0], { source_key: "quy-dinh", files_read: [] }];
    expect(stageExplain(c, text, miss)).toEqual({
      ok: false,
      reason: "path_absent",
      offenders: ["qd.md"],
    });
    const nul = [both[0], { source_key: "quy-dinh", files_read: null }];
    expect(stageExplain(c, text, nul)).toEqual({ ok: true });
    expect(stageExplain(ctx([]), "không có mục", [])).toEqual({ ok: true });
  });
  it("PB-R09 · RFB-11 · refsOk ⇒ chỉ 'Thiếu mục: …' các mục template thiếu", () => {
    const f: string = feedback(["## Kết luận", "## Rủi ro"], true, ctx(["app-repo"]), md(), []);
    expect(f).toContain("Thiếu mục");
    expect(f).toContain("## Kết luận");
    expect(f).toContain("## Rủi ro");
  });
  it("PB-R09 · RFB-12 · lỗi nguồn ⇒ mục khác thiếu + thông điệp theo reason; không lặp heading nguồn vào 'Thiếu mục'", () => {
    const text = md(`app-repo:src/zz.ts@${C1}`);
    const reads = [{ source_key: "app-repo", files_read: ["src/a.ts"] }];
    const f: string = feedback(["## Kết luận", HEAD], false, ctx(["app-repo"]), text, reads);
    expect(f).toContain("## Kết luận");
    expect(f).toContain("src/zz.ts");
    expect(f).not.toContain(`Thiếu mục: ## Kết luận, ${HEAD}`);
    const onlySrc: string = feedback([HEAD], false, ctx(["app-repo"]), text, reads);
    expect(onlySrc).toContain("src/zz.ts");
    expect(onlySrc.startsWith("Thiếu mục")).toBe(false);
  });
});
