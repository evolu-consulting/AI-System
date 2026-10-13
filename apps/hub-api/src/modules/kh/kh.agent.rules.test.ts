// HUB-FR-132 · plan K1 §2.3, §3.4 — ca biên ngoài test khoá (tests/acceptance/K1/rules/kh-agent-rules.test.ts).
import { describe, expect, test } from "bun:test";
import { type KhJobItem, khResolveProject, khToolDescription } from "./kh.agent.rules";

const item = (n: number, summary: string | null, projects: string[]): KhJobItem => ({
  connection_id: `c-${n}`,
  name: `kh-${n}`,
  summary_project: summary,
  projects,
});

describe("mô tả tool + chọn project", () => {
  test("HUB-FR-132 · không có mặc định ⇒ kết thúc 'Projects: <nhãn>.' không 'Default'", () => {
    const d = khToolDescription([item(1, null, ["proj-a", "proj-b"])]);
    expect(d.endsWith("Projects: proj-a, proj-b.")).toBe(true);
    expect(d.includes("Default")).toBe(false);
  });
  test("HUB-FR-132 · nhãn quá dài ⇒ cắt nhãn cuối, thêm '…', giữ 'Default', ≤ 4000", () => {
    const many = Array.from({ length: 50 }, (_, i) => `${"y".repeat(120)}${i}`);
    const d = khToolDescription(
      [1, 2, 3].map((n) => item(n, n === 1 ? (many[0] ?? null) : null, many)),
    );
    expect(d.length).toBeLessThanOrEqual(4000);
    expect(d.includes(", ….")).toBe(true);
    expect(d.endsWith(`Default: kh-1/${many[0]}.`)).toBe(true);
  });
  test("HUB-FR-132 · Q24 · summary_project không có trong projects ⇒ required", () => {
    expect(khResolveProject([item(1, "zz", ["proj-a"])], undefined)).toEqual({
      ok: false,
      reason: "required",
      labels: ["proj-a"],
    });
  });
});
