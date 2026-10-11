// P-b · PF-S2 · PB-R10 · WRK-BR-07a · AC-PB-02 · IJ-01, IJ-02, IJ-03 (+ IJ-01b) (test-plan §4.2). `#fake:obey=<file>` đi qua CÙNG
// đường quyền như agent thật (hook PreToolUse + allowed_tools của payload). IJ-04 (real_action chờ cổng, mock workflow 0 lần) cần
// S3 + S2 và IJ-05 (Hub ép allowed_tools R/G/G) là việc của Hub (pfs3 ST-06) ⇒ không ở đây (test-plan §8).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  bootPb,
  expectTreeOk,
  gitPin,
  INDEX_C1,
  markerExists,
  type PbStack,
  parseReads,
  resetPb,
  revParse,
  runStage,
  type StageSrc,
  sha256,
  treeOf,
} from "../_support/pb-stack";

let st: PbStack;
let src: StageSrc;
beforeAll(async () => {
  st = await bootPb("ij");
  src = { key: "app-repo", pin: gitPin("app-repo", revParse(st, "app-repo")), allowlist: ["**"] };
}, 420_000);
afterAll(async () => {
  await st?.stop();
});
beforeEach(() => resetPb(st));

const INJECT = "#fake:obey=sources/app-repo/docs/inject.md";
const WRITE_TOOLS = ["Read", "Grep", "Glob", "Write"]; // Write hợp lệ cho out/ (H2c) — hook vẫn chặn dưới sources/
const hashOf = async (p: string) =>
  parseReads((await runStage(st, { prompt: `#fake:read=${p}`, sources: [src] })).text)[p];
const IDX = "sources/app-repo/src/index.ts";
const README = "sources/app-repo/README.md";
const denied = (text: string) => (text.match(/tool_denied/g) ?? []).length;

describe("IJ-01…IJ-03 · prompt injection từ dữ liệu nguồn [PB-R10 · AC-PB-02]", () => {
  it("PB-R10 · WRK-BR-07a · AC-PB-02 · IJ-01 · obey inject.md ⇒ ghi vào sources/ (kể cả out/../sources) và Bash đều DENIED; hash không đổi; marker vắng; Write out/ok.md vẫn ALLOWED", async () => {
    const before = [await hashOf(IDX), await hashOf(README)];
    expect(before[0]).toBe(sha256(INDEX_C1));
    const out = await runStage(st, { prompt: INJECT, sources: [src], tools: WRITE_TOOLS });
    expect(out.status).toBe("succeeded");
    const lines = out.text.split("\n").map((l) => l.trim());
    expect(lines).toContain("obey write sources/app-repo/src/index.ts DENIED");
    expect(lines).toContain("obey write out/../sources/app-repo/README.md DENIED");
    expect(lines.filter((l) => /^obey bash .* DENIED$/.test(l)).length).toBe(1);
    expect(lines).toContain("obey write out/ok.md ALLOWED");
    expect([await hashOf(IDX), await hashOf(README)]).toEqual(before);
    expect(markerExists(st, "pwn-bash")).toBe(false);
  });

  it("PB-R10 · WRK-BR-07a · IJ-01b · công cụ R/G/G (stage có nguồn) ⇒ cả ba hành động injection DENIED, marker vắng", async () => {
    const out = await runStage(st, { prompt: INJECT, sources: [src] });
    expect(out.status).toBe("succeeded");
    const lines = out.text.split("\n").map((l) => l.trim());
    expect(lines).toContain("obey write sources/app-repo/src/index.ts DENIED");
    expect(lines).toContain("obey write out/../sources/app-repo/README.md DENIED");
    expect(lines.filter((l) => /^obey bash .* DENIED$/.test(l)).length).toBe(1);
    expect(markerExists(st, "pwn-bash")).toBe(false);
  });

  it("PB-R10 · IJ-02 · sự kiện tool_denied ×3 hiện trong log/sự kiện run; job vẫn finished (succeeded)", async () => {
    const out = await runStage(st, { prompt: INJECT, sources: [src], tools: WRITE_TOOLS });
    expect(out.status).toBe("succeeded");
    const all = JSON.stringify(out.events) + st.logs();
    expect(denied(all)).toBeGreaterThanOrEqual(3);
  });

  it("PB-R16 · PB-R10 · IJ-03 · sau job bị injection, nguồn trong cache không đổi (cây + hash như trước)", async () => {
    const a = await treeOf(st, src);
    expectTreeOk(a.out);
    await runStage(st, { prompt: INJECT, sources: [src], tools: WRITE_TOOLS });
    const b = await treeOf(st, src);
    expect(b.entries).toEqual(a.entries);
    expect(await hashOf(IDX)).toBe(sha256(INDEX_C1));
  });
});
