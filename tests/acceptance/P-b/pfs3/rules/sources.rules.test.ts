// P-b · PF-S3 · HUB-FR-122/123 · PB-R09/R10/R12/R17 · C5/C16/C17 · RF-01…RF-33 (test-plan §4.3).
// Hàm thuần `apps/hub-api/src/modules/processes/runs/sources.rules.ts` (chữ ký chốt plan §3.4). Tra hàm theo TÊN (import động) để
// biên dịch được và đỏ ở `expect` nếu thiếu export — không đỏ vì lỗi cú pháp.
import { describe, expect, it } from "bun:test";

// biome-ignore lint/suspicious/noExplicitAny: tra theo tên
type Fn = (...a: any[]) => any;
const mod = (await import(
  "../../../../../apps/hub-api/src/modules/processes/runs/sources.rules"
)) as Record<string, unknown>;
/** Lấy hàm theo tên; thiếu ⇒ hàm ném lỗi có nhãn ĐỎ-DO-CHƯA-CODE (kèm `expect` đỏ rõ nghĩa). */
function fn(name: string): Fn {
  expect({ [name]: typeof mod[name] }).toEqual({ [name]: "function" });
  return mod[name] as Fn;
}

const C1 = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const C2 = "b2c3d4e5f60718293a4b5c6d7e8f901234567890";
const URL = "https://github.com/pb-test/app-repo.git";
const PIN = { kind: "git_remote", url: URL, sha: C1 };
const PINS = { "app-repo": PIN };
const st = (...a: { source_key: string; allowlist: string[] }[]) => ({ sources: a });
const s = (key: string, ...allowlist: string[]) => ({ source_key: key, allowlist });

describe("RF-01…05 · allowlistUnion [HUB-FR-122, PB-R06]", () => {
  it("HUB-FR-122 · RF-01 · 1 stage ['src/**'] ⇒ ['src/**']", () => {
    expect(fn("allowlistUnion")([st(s("app-repo", "src/**"))], "app-repo")).toEqual(["src/**"]);
  });
  it("HUB-FR-122 · RF-02 · 2 stage ⇒ hợp, sắp xếp, khử trùng", () => {
    const u = fn("allowlistUnion");
    expect(u([st(s("app-repo", "src/**")), st(s("app-repo", "docs/**"))], "app-repo")).toEqual([
      "docs/**",
      "src/**",
    ]);
    expect(
      u([st(s("app-repo", "src/**", "docs/**")), st(s("app-repo", "src/**"))], "app-repo"),
    ).toEqual(["docs/**", "src/**"]);
  });
  it("HUB-FR-122 · RF-03 · có stage allowlist [] (cả nguồn) ⇒ [] dù stage khác có glob", () => {
    const u = fn("allowlistUnion");
    expect(u([st(s("app-repo")), st(s("app-repo", "src/**"))], "app-repo")).toEqual([]);
    expect(u([st(s("app-repo", "src/**")), st(s("app-repo"))], "app-repo")).toEqual([]);
  });
  it("HUB-FR-122 · RF-04 · stage không dùng nguồn (khác key / không có sources) bị bỏ qua", () => {
    const u = fn("allowlistUnion");
    const stages = [st(s("other-repo", "x/**")), {}, { sources: [] }, st(s("app-repo", "src/**"))];
    expect(u(stages, "app-repo")).toEqual(["src/**"]);
  });
  it("PB-R06 · RF-05 · hợp > 40 phần tử ⇒ RangeError; đúng 40 vẫn qua", () => {
    const u = fn("allowlistUnion");
    const g = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}/**`);
    const ok = [st(s("app-repo", ...g("a", 20))), st(s("app-repo", ...g("b", 20)))];
    expect(u(ok, "app-repo")).toHaveLength(40);
    const over = [...ok, st(s("app-repo", "c0/**"))];
    expect(() => u(over, "app-repo")).toThrow(RangeError);
  });
});

describe("RF-06…10 · forceSourceTools [PB-R10, D7]", () => {
  it.each([
    [["Write", "Bash", "WebFetch"]],
    [["Read", "Write"]],
    [[]],
    [["Read", "Grep", "Glob", "Write"]],
  ])("PB-R10 · RF-06…09 · có nguồn, agent %j ⇒ ['Read','Grep','Glob']", (tools) => {
    expect(fn("forceSourceTools")(true, tools)).toEqual(["Read", "Grep", "Glob"]);
  });
  it("PB-R10 · RF-10 · không nguồn ⇒ giữ nguyên danh sách agent", () => {
    const f = fn("forceSourceTools");
    expect(f(false, ["Read", "Write", "Bash"])).toEqual(["Read", "Write", "Bash"]);
    expect(f(false, [])).toEqual([]);
  });
});

describe("RF-11…14 · defaultSourceBudget [PB-R12, C17]", () => {
  it("PB-R12 · RF-11 · có nguồn, không budget ⇒ 200000", () => {
    expect(fn("defaultSourceBudget")({ token_budget: null }, true)).toBe(200000);
  });
  it("PB-R12 · RF-12 · có nguồn, budget 80000 ⇒ 80000", () => {
    expect(fn("defaultSourceBudget")({ token_budget: 80000 }, true)).toBe(80000);
  });
  it("PB-R12 · RF-13 · không nguồn ⇒ hành vi P-a (giữ token_budget, null vẫn null)", () => {
    const b = fn("defaultSourceBudget");
    expect(b({ token_budget: null }, false)).toBeNull();
    expect(b({ token_budget: 80000 }, false)).toBe(80000);
  });
  it.each([0, -5])("PB-R12 · RF-14 · budget %d + có nguồn ⇒ lỗi", (v) => {
    const f = fn("defaultSourceBudget"); // lấy hàm TRƯỚC khi bọc toThrow (thiếu export ⇒ đỏ, không xanh giả)
    expect(() => f({ token_budget: v }, true)).toThrow();
  });
});

describe("RF-15…19 · buildManifest [PB-R10, HUB-BR-31]", () => {
  const lib = {
    kind: "library",
    document_id: "b3b30000-0000-4000-8000-000000000701",
    version: "b3b30000-0000-4000-8000-000000000801",
  };
  const items = [
    { key: "app-repo", description: "Mã nguồn ứng dụng kế toán", pin: PIN },
    { key: "docs-lib", description: "Quy định nội bộ", pin: lib },
  ];
  it("PB-R10 · RF-15 · chứa key, mô tả và sha 40 hex", () => {
    const md: string = fn("buildManifest")(items.slice(0, 1));
    expect(md).toContain("app-repo");
    expect(md).toContain("Mã nguồn ứng dụng kế toán");
    expect(md).toContain(C1);
    expect(md).toMatch(/sources\/app-repo/); // đường dẫn mount
  });
  it("PB-R10 · RF-16 · mỗi nguồn đúng 1 mục (sha xuất hiện 1 lần, version library 1 lần)", () => {
    const md: string = fn("buildManifest")(items);
    expect(md.split(C1).length - 1).toBe(1);
    expect(md.split(lib.version).length - 1).toBe(1);
  });
  it("PB-R10 · RF-17 · thứ tự theo danh sách đầu vào (= stage.sources)", () => {
    const b = fn("buildManifest");
    const a: string = b(items);
    expect(a.indexOf("app-repo")).toBeLessThan(a.indexOf("docs-lib"));
    const r: string = b([...items].reverse());
    expect(r.indexOf("docs-lib")).toBeLessThan(r.indexOf("app-repo"));
  });
  it("PB-R10 · RF-18 · library hiện version (uuid), không có 'sha' giả", () => {
    const md: string = fn("buildManifest")(items.slice(1));
    expect(md).toContain(lib.version);
    expect(md).toContain("docs-lib");
  });
  it("PB-R11 · RF-19 · không lộ url có credential (user:pass@ / token)", () => {
    const dirty = {
      key: "app-repo",
      description: "x",
      pin: {
        kind: "git_remote",
        url: "https://x-access-token:ghp_SECRET1@github.com/pb-test/app-repo.git",
        sha: C1,
      },
    };
    const md: string = fn("buildManifest")([dirty]);
    expect(md).not.toContain("ghp_SECRET1");
    expect(md).not.toContain("x-access-token");
    expect(md).not.toMatch(/\/\/[^/\s@]+@/);
    expect(md).toContain(C1);
  });
});

describe("RF-20…27 · checkSourceRefs [PB-R09, HUB-FR-123, C16]", () => {
  const chk = (md: string, keys = ["app-repo"], pins: unknown = PINS, reads?: string[] | null) =>
    fn("checkSourceRefs")(md, keys, pins, reads);
  const H = "## Nguồn tham chiếu";
  it("PB-R09 · RF-20 · hợp lệ 2 dòng key:path@sha (3 đối số ⇒ chỉ kiểm key + version) ⇒ {ok:true}", () => {
    const md = `## Kết quả\nxong\n\n${H}\napp-repo:src/index.ts@${C1}\napp-repo:src/util/helper.ts@${C1}\n`;
    expect(chk(md)).toEqual({ ok: true });
  });
  it("PB-R09 · RF-21 · thiếu heading ⇒ missing", () => {
    expect(chk("## Kết quả\nxong\n")).toEqual({ ok: false, reason: "missing" });
  });
  it("PB-R09 · RF-22 · heading rỗng ⇒ empty", () => {
    expect(chk(`${H}\n\n`)).toEqual({ ok: false, reason: "empty" });
    expect(chk(`${H}\n\n## Ghi chú\nabc:def@1\n`)).toEqual({ ok: false, reason: "empty" });
  });
  it("PB-R09 · RF-23 · key ngoài nguồn của stage ⇒ unknown_key", () => {
    expect(chk(`${H}\nother-repo:README.md@${C1}\n`)).toEqual({ ok: false, reason: "unknown_key" });
  });
  it.each(["main", C2])("PB-R09 · RF-24 · @%s ≠ phiên bản ghim ⇒ version_mismatch", (ver) => {
    expect(chk(`${H}\napp-repo:src/index.ts@${ver}\n`)).toEqual({
      ok: false,
      reason: "version_mismatch",
    });
  });
  it("PB-R09 · RF-25 · heading trong khối ``` bị bỏ qua ⇒ missing", () => {
    const md = `## Kết quả\n\`\`\`\n${H}\napp-repo:src/index.ts@${C1}\n\`\`\`\n`;
    expect(chk(md)).toEqual({ ok: false, reason: "missing" });
  });
  it("PB-R09 · RF-26 · heading sai chữ hoa '## nguồn tham chiếu' ⇒ coi như thiếu", () => {
    expect(chk(`## nguồn tham chiếu\napp-repo:src/index.ts@${C1}\n`)).toEqual({
      ok: false,
      reason: "missing",
    });
  });
  it("PB-R09 · RF-27 · stage không nguồn ⇒ ok dù không có heading", () => {
    expect(chk("## Kết quả\nxong\n", [], {})).toEqual({ ok: true });
  });
  it("PB-R07 · C16 · RF-20b · path đối chiếu files_read: có ⇒ ok; vắng ⇒ path_absent; null ⇒ bỏ kiểm path", () => {
    const md = `${H}\napp-repo:src/index.ts@${C1}\n`;
    expect(chk(md, ["app-repo"], PINS, ["src/index.ts", "README.md"])).toEqual({ ok: true });
    expect(chk(md, ["app-repo"], PINS, ["README.md"])).toEqual({
      ok: false,
      reason: "path_absent",
    });
    expect(chk(md, ["app-repo"], PINS, [])).toEqual({ ok: false, reason: "path_absent" });
    expect(chk(md, ["app-repo"], PINS, null)).toEqual({ ok: true });
  });
  it("PB-R09 · RF-20c · mục kết thúc ở heading `##` kế tiếp; library @version uuid ok", () => {
    const lv = "b3b30000-0000-4000-8000-000000000801";
    const pins = {
      "docs-lib": {
        kind: "library",
        document_id: "b3b30000-0000-4000-8000-000000000701",
        version: lv,
      },
    };
    const md = `${H}\ndocs-lib:quy-dinh.md@${lv}\n\n## Ghi chú\nkhông-phải-ref:x@y\n`;
    expect(chk(md, ["docs-lib"], pins)).toEqual({ ok: true });
  });
});

describe("RF-28…33 · mapTeamError [PB-R17, #134]", () => {
  const CODES = [
    "ALL_PROVIDERS_EXHAUSTED",
    "TIMEOUT",
    "UPSTREAM_ERROR",
    "CANCELLED",
    "BUDGET_EXCEEDED",
    "NOT_CONFIGURED",
    "INTERNAL_ERROR",
  ];
  it("PB-R17 · RF-28 · not_configured ⇒ NOT_CONFIGURED", () => {
    expect(fn("mapTeamError")("not_configured")).toBe("NOT_CONFIGURED");
  });
  it.each(["job_timeout", "expired"])("PB-R17 · RF-29/30 · %s ⇒ TIMEOUT", (r) => {
    expect(fn("mapTeamError")(r)).toBe("TIMEOUT");
  });
  it("PB-R17 · RF-31 · agent_failed ⇒ UPSTREAM_ERROR", () => {
    expect(fn("mapTeamError")("agent_failed")).toBe("UPSTREAM_ERROR");
  });
  it("PB-R17 · RF-32 · lỗi lạ / chuỗi 'Error: …' / null / undefined ⇒ INTERNAL_ERROR", () => {
    const m = fn("mapTeamError");
    for (const v of ["boom", "Error: x", "", null, undefined]) expect(m(v)).toBe("INTERNAL_ERROR");
  });
  it("PB-R17 · RF-33 · mọi đầu vào ⇒ ∈ 7 mã runs_error_code_ck, không bao giờ null", () => {
    const m = fn("mapTeamError");
    for (const v of [
      "not_configured",
      "job_timeout",
      "expired",
      "agent_failed",
      "zzz",
      null,
      undefined,
      "",
    ]) {
      const out = m(v);
      expect(out).not.toBeNull();
      expect(CODES).toContain(out);
    }
  });
});
