// P-b · PF-S2 · PB-R07 · AC-H36 (f) · LM-01…LM-05 (test-plan §4.2): trần 50 MB / 2.000 file tính SAU allowlist + lọc; vượt ⇒
// SOURCE_TOO_LARGE, không cắt âm thầm, không để dir dở. Phần "start run ⇒ needs_decision source_unresolvable, không job
// failed→NOT_CONFIGURED" (LM-02) cần launcher S3 ⇒ chuyển sang scenario SC-PB2 (khai ở test-plan §8).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  bootPb,
  bulkScript,
  checkSource,
  createSource,
  errCode,
  expectTreeOk,
  gitPin,
  gitSrcBody,
  must,
  type PbStack,
  resetPb,
  revParse,
  runStage,
  treeOf,
} from "../_support/pb-stack";

let st: PbStack;
beforeAll(async () => {
  st = await bootPb("lm");
  must(st.sh(bulkScript("many-repo", { files: 1995, dotenv: 10 })), "dựng many-repo");
  must(st.sh(bulkScript("too-many", { files: 2001 })), "dựng too-many");
  must(st.sh(bulkScript("edge-2000", { files: 2000 })), "dựng edge-2000");
  must(st.sh(bulkScript("fat-repo", { bigBytes: 60_000_000, srcFile: true })), "dựng fat-repo");
  must(st.sh(bulkScript("fat-ok", { bigBytes: 40_000_000 })), "dựng fat-ok");
}, 600_000);
afterAll(async () => {
  await st?.stop();
});
beforeEach(() => resetPb(st));

const TOO_LARGE = { status: 422, code: "SOURCE_TOO_LARGE" };

describe("LM-01…LM-05 · trần nguồn [PB-R07 · AC-H36(f)]", () => {
  it("PB-R07 · LM-01 · many-repo 2.005 file (10 là .env*) ⇒ check 200 files=1995 (trần tính SAU lọc); stage f/** thấy 1995 file", async () => {
    await createSource(st, "Adm", gitSrcBody("many", "many-repo"));
    const r = await checkSource(st, "Adm", "many");
    expect(r.status).toBe(200);
    expect(r.json.files).toBe(1995);
    expect(r.json.bytes).toBe(1995);
    const t = await treeOf(st, {
      key: "many",
      pin: gitPin("many-repo", revParse(st, "many-repo")),
      allowlist: ["f/**"],
    });
    expectTreeOk(t.out);
    expect(t.files?.length).toBe(1995);
  });

  it("PB-R07 · AC-H36(f) · LM-02 · too-many 2.001 file ⇒ check 422 SOURCE_TOO_LARGE; edge-2000 đúng 2.000 ⇒ 200", async () => {
    await createSource(st, "Adm", gitSrcBody("many2", "too-many"));
    await createSource(st, "Adm", gitSrcBody("edge", "edge-2000"));
    expect(errCode(await checkSource(st, "Adm", "many2"))).toEqual(TOO_LARGE);
    const ok = await checkSource(st, "Adm", "edge");
    expect(ok.status).toBe(200);
    expect(ok.json.files).toBe(2000);
  });

  it("PB-R07 · AC-H36(f) · LM-03 · fat-repo 60 MB: allowlist src/** ok (trần SAU allowlist); không allowlist ⇒ check 422; assets/** ⇒ job không dựng được; fat-ok 40 MB ok", async () => {
    const pin = gitPin("fat-repo", revParse(st, "fat-repo"));
    const small = await treeOf(st, { key: "fat", pin, allowlist: ["src/**"] });
    expectTreeOk(small.out);
    expect(small.files).toEqual(["src/a.txt"]);
    await createSource(st, "Adm", gitSrcBody("fat", "fat-repo"));
    expect(errCode(await checkSource(st, "Adm", "fat"))).toEqual(TOO_LARGE);
    const big = await runStage(st, {
      prompt: "#fake:tree=sources/fat",
      sources: [{ key: "fat", pin, allowlist: ["assets/**"] }],
    });
    expect(big.status).not.toBe("succeeded");
    await createSource(st, "Adm", gitSrcBody("fatok", "fat-ok"));
    const ok = await checkSource(st, "Adm", "fatok");
    expect(ok.status).toBe(200);
    expect(ok.json.files).toBe(1);
    expect(ok.json.bytes).toBe(40_000_000);
  });

  it("PB-R07 · LM-04 · không cắt âm thầm: ca lỗi SOURCE_TOO_LARGE không trả pin/files/bytes một phần", async () => {
    await createSource(st, "Adm", gitSrcBody("many2", "too-many"));
    const r = await checkSource(st, "Adm", "many2");
    expect(errCode(r)).toEqual(TOO_LARGE);
    expect(r.json.pin).toBeUndefined();
    expect(r.json.files).toBeUndefined();
    expect(r.json.bytes).toBeUndefined();
    expect(r.text).not.toContain('"sha"');
  });

  it("PB-R16 · LM-05 · sau lỗi quá cỡ, RUNTIME_SOURCE_CACHE_DIR không còn thư mục snapshot dở (*.tmp*)", async () => {
    await createSource(st, "Adm", gitSrcBody("fat", "fat-repo"));
    expect(errCode(await checkSource(st, "Adm", "fat"))).toEqual(TOO_LARGE);
    const left = st.sh(`find /cache -name '*.tmp*' | wc -l`);
    expect(Number(left.out)).toBe(0);
  });
});
