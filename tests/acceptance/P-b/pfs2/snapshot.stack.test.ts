// P-b · PF-S2 · WRK-FR-27 · HUB-FR-122 · PB-R05/R07/R15/R16 · AC-H36 (a)(c)(g) · AC-PB-01 · SN-01…SN-15 (test-plan §4.2).
// Stack thật: Hub (host) + Runtime Python (container, fake-cli) + repo git bare trong container. SN-16 (MANIFEST.md do Hub dựng,
// vào `prompt`) chuyển sang pfs3 (RF-15…19 / SC-PB1) — payload `sources[]` không mang mô tả nguồn nên Runtime không dựng được.
// Đỏ trước code S2: `source.resolve` không ai claim (check quá hạn) / directive fake-cli `tree|read|scan` chưa có.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  APP_C1_FILES,
  APP_C1_FILTERED,
  appRepoScript,
  bootPb,
  bytesAt,
  checkSource,
  createSource,
  docsGitScript,
  expectTreeOk,
  gitPin,
  gitSrcBody,
  INDEX_C1,
  INDEX_C2,
  must,
  type PbStack,
  parseReads,
  parseTree,
  pushC2Script,
  resetPb,
  revParse,
  runStage,
  type StageSrc,
  sha256,
  treeOf,
  urlOf,
} from "../_support/pb-stack";

let st: PbStack;
let c1 = "";
beforeAll(async () => {
  st = await bootPb("sn");
  c1 = revParse(st, "app-repo", "main");
}, 420_000);
afterAll(async () => {
  await st?.stop();
});
beforeEach(() => resetPb(st));

const app = (allow: string[] = [], sha = c1): StageSrc => ({
  key: "app-repo",
  pin: gitPin("app-repo", sha),
  allowlist: allow,
});
const readOf = async (src: StageSrc, path: string, extra = {}): Promise<string | undefined> => {
  const out = await runStage(st, { prompt: `#fake:read=${path}`, sources: [src], ...extra });
  return parseReads(out.text)[path];
};
const scanN = (text: string, needle: string): number => {
  const m = new RegExp(`^scan ${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\d+)$`, "m").exec(
    text,
  );
  return m ? Number(m[1]) : Number.NaN;
};

describe("SN-01…SN-08 · lọc PB-R07 + check [AC-H36(a) · AC-PB-01]", () => {
  it("HUB-FR-122 · AC-H36 · SN-01 · check app-repo main ⇒ pin.sha == rev-parse C1, files=6, bytes = tổng 6 file", async () => {
    await createSource(st, "Adm", gitSrcBody("app-repo", "app-repo"));
    const r = await checkSource(st, "Adm", "app-repo");
    expect(r.status).toBe(200);
    expect(r.json.pin).toEqual({ kind: "git_remote", url: urlOf("app-repo"), sha: c1 });
    expect(r.json.files).toBe(6);
    expect(r.json.bytes).toBe(bytesAt(st, "app-repo", c1, APP_C1_FILES));
  });

  it("WRK-FR-27 · PB-R06 · SN-02 · stage allowlist src/** ⇒ cây đúng 2 file", async () => {
    const t = await treeOf(st, app(["src/**"]));
    expectTreeOk(t.out);
    expect(t.files).toEqual(["src/index.ts", "src/util/helper.ts"]);
  });

  it.each([["**/*"], ["**"]])(
    "PB-R07 · AC-PB-01 · SN-03 · allowlist %p ⇒ 6 file; .env*/.ssh/.aws/.npmrc/.netrc/id_rsa*/secrets*/credentials*/cert/* vắng",
    async (glob) => {
      const t = await treeOf(st, app([glob as string]));
      expectTreeOk(t.out);
      expect(t.files).toEqual([...APP_C1_FILES]);
      for (const p of APP_C1_FILTERED) expect(t.files).not.toContain(p);
    },
  );

  it("PB-R07 · AC-PB-01 · SN-04 · allowlist nêu thẳng **/.env + src/** ⇒ .env vẫn vắng (lọc thắng allowlist)", async () => {
    const t = await treeOf(st, app(["**/.env", "src/**"]));
    expectTreeOk(t.out);
    expect(t.files).not.toContain(".env");
    expect(t.files).toEqual(["src/index.ts", "src/util/helper.ts"]);
  });

  it("PB-R07 · C8 · SN-05 · .gitignore còn trong snapshot (chỉ basename .git bị lọc); không entry nào tên đúng .git", async () => {
    const t = await treeOf(st, app(["**"]));
    expectTreeOk(t.out);
    expect(t.files).toContain(".gitignore");
    const names = (t.entries ?? []).map((e) => e.path.split("/").pop());
    expect(names).not.toContain(".git");
  });

  it("PB-R07 · AC-PB-01 · SN-06 · symlink link-out/link-in/link-dir vắng; đọc link-out ⇒ ENOENT (không lộ /etc/hostname)", async () => {
    const src = app(["**"]);
    const t = await treeOf(st, src);
    expectTreeOk(t.out);
    for (const n of ["link-out", "link-in", "link-dir"]) expect(t.files).not.toContain(n);
    expect((t.entries ?? []).filter((e) => e.type === "l")).toEqual([]);
    expect(await readOf(src, "sources/app-repo/link-out")).toBe("ENOENT");
  });

  it("PB-R07 · SN-07 · gitlink ext/sub (submodule) vắng, không có thư mục rỗng ext/", async () => {
    const t = await treeOf(st, app(["**"]));
    expectTreeOk(t.out);
    const hit = (t.entries ?? []).filter((e) => e.path === "ext" || e.path.startsWith("ext/"));
    expect(hit).toEqual([]);
  });

  it("HUB-FR-122 · SN-08 · files/bytes của check == số/cỡ file trong cây cùng allowlist", async () => {
    await createSource(st, "Adm", gitSrcBody("app-repo", "app-repo"));
    const r = await checkSource(st, "Adm", "app-repo");
    expect(r.status).toBe(200);
    const t = await treeOf(st, app(["**"]));
    expectTreeOk(t.out);
    expect(r.json.files).toBe(t.files?.length ?? -1);
    expect(r.json.bytes).toBe(bytesAt(st, "app-repo", c1, t.files ?? []));
  });
});

describe("SN-09…SN-16 · chỉ-đọc, ghim, nhánh, tách nguồn [AC-H36(c)(g) · PB-R10/R15/R16]", () => {
  it("PB-R10 · SN-09 · snapshot chỉ-đọc: mọi mode không bit ghi; ghi đè src/index.ts và tạo NEW.txt đều bị chặn, hash không đổi", async () => {
    const src = app(["src/**"]);
    const t = await treeOf(st, src);
    expectTreeOk(t.out);
    expect((t.entries ?? []).length).toBeGreaterThan(0);
    for (const e of t.entries ?? [])
      expect({ p: e.path, w: e.mode & 0o222 }).toEqual({ p: e.path, w: 0 });
    const idx = "sources/app-repo/src/index.ts";
    expect(await readOf(src, idx)).toBe(sha256(INDEX_C1));
    await runStage(st, { prompt: `#fake:write=${idx}`, sources: [src] });
    await runStage(st, { prompt: "#fake:write=sources/app-repo/NEW.txt", sources: [src] });
    expect(await readOf(src, idx)).toBe(sha256(INDEX_C1));
    const after = await treeOf(st, src);
    expect(after.files).toEqual(["src/index.ts", "src/util/helper.ts"]);
  });

  it("AC-H36(c) · PB-R05 · SN-10 · ghim C1; đẩy C2 lên main; job làm lại vẫn đọc nội dung c1; check mới ghim C2 ≠ C1", async () => {
    const idx = "sources/app-repo/src/index.ts";
    const src = app(["src/**"]);
    expect(await readOf(src, idx)).toBe(sha256(INDEX_C1));
    must(st.sh(pushC2Script()), "đẩy C2");
    try {
      const c2 = revParse(st, "app-repo", "main");
      expect(c2).not.toBe(c1);
      expect(await readOf(src, idx)).toBe(sha256(INDEX_C1)); // làm lại: pin cũ
      expect(await readOf(app(["src/**"], c2), idx)).toBe(sha256(INDEX_C2)); // run mới: pin mới
      await createSource(st, "Adm", gitSrcBody("app-repo", "app-repo"));
      const r = await checkSource(st, "Adm", "app-repo");
      expect(r.status).toBe(200);
      expect(r.json.pin.sha).toBe(c2);
      expect(r.json.pin.sha).not.toBe(c1);
    } finally {
      must(st.sh(appRepoScript()), "khôi phục app-repo C1");
    }
  });

  it("HUB-FR-122 · SN-11 · nguồn branch dev ⇒ pin.sha = đầu dev; cây có src/dev-only.ts", async () => {
    await createSource(st, "Adm", gitSrcBody("app-dev", "app-repo", "dev"));
    const r = await checkSource(st, "Adm", "app-dev");
    expect(r.status).toBe(200);
    const dev = revParse(st, "app-repo", "dev");
    expect(r.json.pin.sha).toBe(dev);
    expect(dev).not.toBe(c1);
    const t = await treeOf(st, {
      key: "app-repo",
      pin: gitPin("app-repo", dev),
      allowlist: ["src/**"],
    });
    expectTreeOk(t.out);
    expect(t.files).toContain("src/dev-only.ts");
  });

  it("AC-H36(g) · PB-R15 · SN-12 · không token git trong thư mục job; cây job chỉ attachments/, out/, sources/; không .git*", async () => {
    const src = app(["**"]);
    for (const needle of ["ghp_", "x-access-token", "pbtok-", "GIT_ASKPASS"]) {
      const out = await runStage(st, { prompt: `#fake:scan=${needle}`, sources: [src] });
      expect({ needle, n: scanN(out.text, needle) }).toEqual({ needle, n: 0 });
    }
    const t = await treeOf(st, src, {});
    expectTreeOk(t.out);
    const root = await runStage(st, { prompt: "#fake:tree=.", sources: [src] });
    const entries = parseTree(root.text) ?? [];
    expect(entries.map((e) => e.path)).toContain("sources/app-repo/src/index.ts"); // không rỗng giả
    const top = new Set(entries.map((e) => e.path.split("/")[0]));
    expect(
      [...top].filter((n) => !["attachments", "out", "sources"].includes(n as string)),
    ).toEqual([]);
    const bad = entries.filter((e) =>
      e.path.split("/").some((s) => s === ".git" || s.startsWith(".git-") || s === ".gitconfig"),
    );
    expect(bad).toEqual([]);
  });

  it("HUB-BR-29 · SN-13 · 2 nguồn app-repo + docs-git: sources/app-repo/** và sources/docs-git/** tách biệt", async () => {
    must(st.sh(docsGitScript()), "dựng docs-git");
    const dg = revParse(st, "docs-git", "main");
    const a: StageSrc = app(["**"]);
    const d: StageSrc = { key: "docs-git", pin: gitPin("docs-git", dg), allowlist: ["**"] };
    const ta = await treeOf(st, a, { sources: [a, d] });
    const td = await treeOf(st, d, { sources: [a, d] });
    expectTreeOk(ta.out);
    expectTreeOk(td.out);
    expect(ta.files).toEqual([...APP_C1_FILES]);
    expect(td.files).toEqual(["README.md", "docs/guide.md"]);
  });

  it("WRK-FR-27 · SN-14 · job không nguồn: tree sources ⇒ ENOENT", async () => {
    const out = await runStage(st, { prompt: "#fake:tree=sources" });
    expect(out.status).toBe("succeeded");
    expect(parseTree(out.text)).toBeNull();
  });

  it("PB-R16 · SN-15 · allowlist 20 phần tử dùng chung snapshot: stage docs/** chỉ thấy docs, stage src/** chỉ thấy src", async () => {
    const filler = Array.from({ length: 18 }, (_, i) => `zz/d${i}/**`);
    const wide = await treeOf(st, app(["docs/**", "src/**", ...filler]));
    expectTreeOk(wide.out);
    expect(wide.files).toEqual([
      "docs/inject.md",
      "docs/notes.md",
      "src/index.ts",
      "src/util/helper.ts",
    ]);
    const docs = await treeOf(st, app(["docs/**"]));
    const srcs = await treeOf(st, app(["src/**"]));
    expect(docs.files).toEqual(["docs/inject.md", "docs/notes.md"]);
    expect(srcs.files).toEqual(["src/index.ts", "src/util/helper.ts"]);
  });
});
