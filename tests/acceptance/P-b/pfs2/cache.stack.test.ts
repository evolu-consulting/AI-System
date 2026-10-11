// P-b · PF-S2 · PB-R16 · D9 · AC-H36(c) · CA-01, CA-02, CA-03, CA-05, CA-06 (test-plan §4.2; CA-04 ở cache-lru.stack.test.ts).
// "Run" = job stage dựng bằng SQL với pin cố định (S2 độc lập S3). Phần "run needs_decision source_unresolvable" của CA-03 cần
// launcher S3 ⇒ scenario; ở đây khoá phần Runtime: job không `succeeded`, Runtime/Hub sống tiếp và job sau vẫn chạy.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  appRepoScript,
  bootPb,
  clearCache,
  expectTreeOk,
  gitPin,
  INDEX_C1,
  must,
  type PbStack,
  parseReads,
  pushC2Script,
  resetPb,
  revParse,
  rewriteHistoryScript,
  runStage,
  type StageSrc,
  sha256,
  treeOf,
} from "../_support/pb-stack";

let st: PbStack;
let c1 = "";
beforeAll(async () => {
  st = await bootPb("ca");
  c1 = revParse(st, "app-repo", "main");
}, 420_000);
afterAll(async () => {
  await st?.stop();
});
beforeEach(async () => {
  await resetPb(st);
  must(st.sh(appRepoScript()), "khôi phục app-repo C1");
  clearCache(st);
});

const app = (allow: string[], sha = c1): StageSrc => ({
  key: "app-repo",
  pin: gitPin("app-repo", sha),
  allowlist: allow,
});
const IDX = "sources/app-repo/src/index.ts";
const readIdx = async (src: StageSrc, extra = {}) =>
  parseReads((await runStage(st, { prompt: `#fake:read=${IDX}`, sources: [src], ...extra })).text)[
    IDX
  ];

describe("CA-01…CA-06 · mirror + snapshot cache [PB-R16 · D9]", () => {
  it("PB-R16 · CA-01 · hai run liên tiếp cùng (nguồn, SHA, allowlist) ⇒ cây giống hệt, cả hai ok; cache hit không clone lại (repo biến mất vẫn đọc được)", async () => {
    const src = app(["src/**"]);
    const a = await treeOf(st, src);
    expectTreeOk(a.out);
    must(st.sh("mv /fixtures/app-repo.git /fixtures/app-repo.git.off"), "ẩn repo");
    try {
      const b = await treeOf(st, src);
      expectTreeOk(b.out);
      expect(b.entries).toEqual(a.entries);
      expect(b.files).toEqual(["src/index.ts", "src/util/helper.ts"]);
    } finally {
      must(st.sh("mv /fixtures/app-repo.git.off /fixtures/app-repo.git"), "hiện repo");
    }
  });

  it("PB-R16 · AC-H36(c) · CA-02 · xoá sạch cache giữa stage 0 và làm lại; main đã sang C2, repo còn C1 ⇒ dựng lại từ SHA, đọc đúng c1", async () => {
    const src = app(["src/**"]);
    expect(await readIdx(src)).toBe(sha256(INDEX_C1));
    must(st.sh(pushC2Script()), "đẩy C2");
    clearCache(st);
    expect(revParse(st, "app-repo", "main")).not.toBe(c1);
    expect(await readIdx(src)).toBe(sha256(INDEX_C1));
  });

  it("PB-R16 · CA-03 · cache mất + lịch sử repo bị viết lại (C1 biến mất) ⇒ job không succeeded; Runtime không crash, job sau vẫn chạy", async () => {
    const src = app(["src/**"]);
    expect(await readIdx(src)).toBe(sha256(INDEX_C1));
    clearCache(st);
    must(st.sh(rewriteHistoryScript()), "viết lại lịch sử");
    expect(st.sh(`git -C /fixtures/app-repo.git cat-file -e ${c1}`).code).not.toBe(0); // fixture: C1 đã mất
    const lost = await runStage(st, { prompt: `#fake:read=${IDX}`, sources: [src] });
    expect(lost.status).not.toBe("succeeded");
    expect(lost.errorCode).not.toBeNull();
    const head = revParse(st, "app-repo", "main");
    const t = await treeOf(st, { key: "app-repo", pin: gitPin("app-repo", head), allowlist: [] });
    expectTreeOk(t.out); // Runtime còn sống, dựng được pin mới
    expect(t.files).toEqual(["README.md"]);
  });

  it("PB-R16 · CA-05 · hai run khởi động đồng thời cùng nguồn (cache rỗng) ⇒ cả hai thấy đủ 6 file, không file dở", async () => {
    const src = app(["**"]);
    const [x, y] = await Promise.all([treeOf(st, src), treeOf(st, src)]);
    expectTreeOk(x.out);
    expectTreeOk(y.out);
    const six = [
      ".gitignore",
      "README.md",
      "docs/inject.md",
      "docs/notes.md",
      "src/index.ts",
      "src/util/helper.ts",
    ];
    expect(x.files).toEqual(six);
    expect(y.files).toEqual(six);
  });

  it("PB-R16 · HUB-BR-30 · CA-06 · cùng URL ở acme (allowlist src/**) và beta (allowlist []) ⇒ acme thấy 2 file, beta thấy 6 file (khoá cache theo tenant_id)", async () => {
    const acme = await treeOf(st, app(["src/**"]), { who: "A" });
    const beta = await treeOf(st, app([]), { who: "D" });
    const acme2 = await treeOf(st, app(["src/**"]), { who: "A" });
    expectTreeOk(acme.out);
    expectTreeOk(beta.out);
    expect(acme.files).toEqual(["src/index.ts", "src/util/helper.ts"]);
    expect(beta.files?.length).toBe(6);
    expect(acme2.files).toEqual(acme.files);
  });
});
