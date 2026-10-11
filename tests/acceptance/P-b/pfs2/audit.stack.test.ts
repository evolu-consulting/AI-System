// P-b · PF-S2 · PB-R11 · D8 · AC-H36 (g) · AU-01…AU-04 (test-plan §4.2). Runtime báo `files_read` qua `job.result.source_reads[]`
// (C18: `{source_key, files_read:[path tương đối gốc nguồn]|null, bytes_read}`); Hub ghi hàng `source_job_reads` (pin, tenant,
// stage_run) = AD-01/AD-02 ở pfs3 vì cần run Hub thật. Ở đây khoá phần Runtime: đúng nguồn, đúng file, không token/URL credential.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  bootPb,
  docsGitScript,
  gitPin,
  must,
  type PbStack,
  resetPb,
  revParse,
  runStage,
  type StageOut,
  type StageSrc,
} from "../_support/pb-stack";

let st: PbStack;
let app: StageSrc;
let docs: StageSrc;
beforeAll(async () => {
  st = await bootPb("au");
  must(st.sh(docsGitScript()), "dựng docs-git");
  app = { key: "app-repo", pin: gitPin("app-repo", revParse(st, "app-repo")), allowlist: ["**"] };
  docs = { key: "docs-git", pin: gitPin("docs-git", revParse(st, "docs-git")), allowlist: ["**"] };
}, 420_000);
afterAll(async () => {
  await st?.stop();
});
beforeEach(() => resetPb(st));

type Read = { source_key: string; files_read: string[] | null; bytes_read: number | null };
function readsOf(out: StageOut): Read[] | null {
  const ev = out.events.find((e) => e?.type === "job.result");
  // Chỉ đọc từ EVENT job.result (top-level) — không fallback row hub.jobs.result.
  return (ev?.source_reads ?? null) as Read[] | null;
}
const byKey = (rs: Read[] | null, k: string) => rs?.find((r) => r.source_key === k);

describe("AU-01…AU-04 · audit đọc nguồn [PB-R11 · D8 · AC-H36(g)]", () => {
  it("PB-R11 · D8 · AU-01 · đọc index.ts + helper.ts ⇒ source_reads[app-repo].files_read = đúng 2 path tương đối gốc nguồn", async () => {
    const out = await runStage(st, {
      prompt: "#fake:read=sources/app-repo/src/index.ts,sources/app-repo/src/util/helper.ts",
      sources: [{ ...app, allowlist: ["src/**"] }],
    });
    expect(out.status).toBe("succeeded");
    const r = byKey(readsOf(out), "app-repo");
    expect([...(r?.files_read ?? [])].sort()).toEqual(["src/index.ts", "src/util/helper.ts"]);
    expect(r?.bytes_read === null || typeof r?.bytes_read === "number").toBe(true);
  });

  it("PB-R11 · AU-02 · stage 2 nguồn, chỉ đọc 1 ⇒ 2 mục; nguồn không đọc có files_read = [] (không null)", async () => {
    const out = await runStage(st, {
      prompt: "#fake:read=sources/app-repo/README.md",
      sources: [app, docs],
    });
    expect(out.status).toBe("succeeded");
    const rs = readsOf(out);
    expect(rs?.length).toBe(2);
    expect(byKey(rs, "app-repo")?.files_read).toEqual(["README.md"]);
    expect(byKey(rs, "docs-git")?.files_read).toEqual([]);
  });

  it("PB-R11 · HUB-BR-30 · AU-03 · không chuỗi x-access-token/ghp_/pbtok- trong sự kiện, kết quả, log Runtime; pin.url không có user:pass@", async () => {
    const out = await runStage(st, {
      prompt: "#fake:read=sources/app-repo/README.md",
      sources: [app],
    });
    expect(out.status).toBe("succeeded");
    expect(readsOf(out)).not.toBeNull(); // không xanh giả khi chưa có audit
    const blob = JSON.stringify(out.events) + JSON.stringify(out.result) + st.logs();
    for (const bad of ["x-access-token", "ghp_", "pbtok-"]) expect(blob).not.toContain(bad);
    expect(blob).not.toMatch(/\/\/[^/@\s"]+:[^/@\s"]*@/);
  });

  it("PB-R07 · PB-R11 · AU-04 · đọc .env ⇒ ENOENT và KHÔNG vào files_read (file hợp lệ đọc cùng lúc có)", async () => {
    const out = await runStage(st, {
      prompt: "#fake:read=sources/app-repo/.env,sources/app-repo/README.md",
      sources: [app],
    });
    expect(out.status).toBe("succeeded");
    const r = byKey(readsOf(out), "app-repo");
    expect(r?.files_read).toContain("README.md");
    expect(r?.files_read).not.toContain(".env");
    expect(out.text).toContain("read sources/app-repo/.env ENOENT");
  });
});
