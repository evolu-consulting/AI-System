// CR-114 fix114 · bản tham chiếu chỉ tới job THỰC SỰ có `artifact-get` (một hàm dùng chung với chỗ cấp tool).
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_TOOLS_MAX } from "@ai/contracts/hub";
import {
  ARTIFACT_GET,
  ARTIFACT_SEARCH,
  artifactToolsGranted,
  jobVariant,
  withArtifactTools,
} from "./artifact.mcp";

const task = {
  prompt: "toàn văn",
  history: [{ role: "user" as const, content: "lượt cũ đầy đủ" }],
  byRef: { prompt: "tham chiếu art:aaaaaaaa", history: [] },
};
const keys = (n: number) => Array.from({ length: n }, (_, i) => `wf-${i}`);
const mcpOf = (k: string[]) => ({ tools: k });

describe("CR-114 fix114 · jobVariant", () => {
  it("job có artifact-get ⇒ byRef; noTools (không MCP) / đủ MCP_TOOLS_MAX / cờ tắt ⇒ nguyên văn", () => {
    expect(jobVariant(task, mcpOf(withArtifactTools(keys(3), true)))).toBe(task.byRef);
    // noTools ⇒ runner trả NO_MCP (mcp null).
    expect(jobVariant(task, null)).toBe(task);
    // Đã đủ tool workflow ⇒ không thêm được artifact-get.
    const full = withArtifactTools(keys(MCP_TOOLS_MAX), true);
    expect(full).not.toContain(ARTIFACT_GET);
    expect(jobVariant(task, mcpOf(full))).toBe(task);
    // Còn 1 chỗ ⇒ chỉ artifact-get (đủ để đọc).
    expect(withArtifactTools(keys(MCP_TOOLS_MAX - 1), true)).toContain(ARTIFACT_GET);
    expect(withArtifactTools(keys(MCP_TOOLS_MAX - 1), true)).not.toContain(ARTIFACT_SEARCH);
    expect(jobVariant(task, mcpOf(withArtifactTools(keys(2), false)))).toBe(task);
    expect(artifactToolsGranted(mcpOf([ARTIFACT_SEARCH]))).toBe(false);
  });

  it("chỉ JobAgentRunner đọc byRef (direct-SDK, dify, routing bỏ qua ⇒ nguyên văn)", () => {
    const dir = join(import.meta.dir, "../runner");
    const files = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const readers = files.filter((f) =>
      /\.byRef\b|jobVariant\(/.test(readFileSync(join(dir, f), "utf8")),
    );
    expect(readers.map((f) => f.replaceAll("\\", "/"))).toEqual(["job/job-agent-runner.ts"]);
  });
});
