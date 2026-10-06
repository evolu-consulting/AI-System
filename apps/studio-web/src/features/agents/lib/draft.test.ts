// HUB-FR-60 · H4a-R03, R05, R12 · bản nháp agent: payload lọc theo runtime, validate theo contract, map issues, nhân bản, diff.
import { describe, expect, test } from "bun:test";
import type { Agent } from "@ai/contracts/studio";
import { parseConflict } from "#/lib/conflict";
import {
  type AgentDraft,
  cloneDraft,
  emptyDraft,
  fieldOfPath,
  fromAgent,
  mapIssues,
  toPayload,
  validateDraft,
} from "./draft";
import { diffDrafts } from "./draft-diff";

const PROFILE = "e4a0e000-0000-4000-8000-000000000020";
const WF = "e4a0e000-0000-4000-8000-000000000040";

const valid = (o: Partial<AgentDraft> = {}): AgentDraft => ({
  ...emptyDraft(),
  key: "my-agent",
  nameVi: "Tên",
  nameEn: "Name",
  description: "Mô tả đủ dài để qua ngưỡng hai mươi ký tự.",
  profileId: PROFILE,
  ...o,
});
const NEW = { mode: "new", hadBash: false } as const;

const agent = (o: Partial<Agent> = {}): Agent =>
  ({
    id: "e4a0e000-0000-4000-8000-000000000031",
    key: "hoadon",
    name: { vi: "Hoá đơn", en: "Invoice" },
    description: "Agent hoá đơn dùng cho kiểm thử giao diện.",
    runtime: "agentic-cli",
    agent_type_key: null,
    profile_id: PROFILE,
    system_prompt: "",
    runtime_options: {
      cli: "claude",
      allowed_tools: ["Read", "Bash"],
      mcp: false,
      cwd_mode: "job",
    },
    workflow_ids: [],
    timeout_s: 600,
    token_budget: null,
    enabled: true,
    version: 3,
    workflows: [],
    ...o,
  }) as Agent;

describe("validateDraft", () => {
  test("nháp hợp lệ không có lỗi", () => {
    expect(validateDraft(valid(), NEW)).toEqual({ errors: {}, unmapped: 0 });
  });

  test("key sai, mô tả ngắn, timeout/token ngoài khoảng, thiếu tên → lỗi đúng trường", () => {
    const d = valid({
      key: "Bad_Key",
      nameVi: " ",
      description: "ngắn",
      timeout: "5",
      tokenBudget: "0",
    });
    const { errors } = validateDraft(d, NEW);
    expect(Object.keys(errors).sort()).toEqual(
      ["description", "key", "name.vi", "timeout_s", "token_budget"].sort(),
    );
  });

  test("mô tả 20–400 sau trim: 19 ký tự lỗi, 20 ổn, 401 lỗi", () => {
    const e = (n: number) =>
      validateDraft(valid({ description: ` ${"a".repeat(n)} ` }), NEW).errors;
    expect(e(19).description).toBeDefined();
    expect(e(20).description).toBeUndefined();
    expect(e(401).description).toBeDefined();
  });

  test("agentic-cli: Bash chưa xác nhận ⇒ lỗi bash_ack; đã xác nhận / sửa agent đã có Bash ⇒ ổn", () => {
    const cli = valid({ runtime: "agentic-cli", tools: ["Read", "Bash"] });
    expect(validateDraft(cli, NEW).errors.bash_ack).toBeDefined();
    expect(validateDraft({ ...cli, bashAck: true }, NEW).errors.bash_ack).toBeUndefined();
    expect(validateDraft(cli, { mode: "edit", hadBash: true }).errors.bash_ack).toBeUndefined();
  });

  test("dify-workflow cần đúng 1 workflow; không đòi profile", () => {
    const d = valid({ runtime: "dify-workflow", profileId: "" });
    expect(validateDraft(d, NEW).errors).toEqual({ workflow_ids: "editor.err.workflow" });
    expect(validateDraft({ ...d, workflowIds: [WF] }, NEW).errors).toEqual({});
  });

  test("llm thiếu profile ⇒ lỗi profile_id", () => {
    expect(validateDraft(valid({ profileId: "" }), NEW).errors.profile_id).toBeDefined();
  });
});

describe("toPayload", () => {
  test("dify-* bỏ profile_id/runtime_options dù nháp còn giữ giá trị", () => {
    const p = toPayload(valid({ runtime: "dify-agent", workflowIds: [WF] }));
    expect(p).not.toHaveProperty("profile_id");
    expect(p).not.toHaveProperty("runtime_options");
    expect(p).toMatchObject({ key: "my-agent", runtime: "dify-agent", workflow_ids: [WF] });
  });

  test("PUT không có key/runtime, có version; token trống ⇒ null", () => {
    const p = toPayload(valid(), 4);
    expect(p).not.toHaveProperty("key");
    expect(p).not.toHaveProperty("runtime");
    expect(p).toMatchObject({ version: 4, token_budget: null, timeout_s: 600 });
  });

  test("bash_ack chỉ gửi khi có Bash và đã tick", () => {
    const cli = valid({ runtime: "agentic-cli", tools: ["Read", "Bash"], bashAck: true });
    expect(toPayload(cli)).toMatchObject({ bash_ack: true });
    expect(toPayload({ ...cli, tools: ["Read"] })).not.toHaveProperty("bash_ack");
  });
});

describe("issues → trường", () => {
  test("path chuỗi/mảng/chỉ số mảng", () => {
    expect(fieldOfPath("name.vi")).toBe("name.vi");
    expect(fieldOfPath(["workflow_ids", 0])).toBe("workflow_ids");
    expect(fieldOfPath("runtime_options.allowed_tools")).toBeNull();
  });

  test("mapIssues đếm issue không map được", () => {
    const r = mapIssues([{ path: "description" }, { path: "lạ" }]);
    expect(r.errors).toEqual({ description: "editor.err.description" });
    expect(r.unmapped).toBe(1);
  });
});

describe("nhân bản (R12) và diff", () => {
  test("cloneDraft: Key trống, tên thêm hậu tố, agent tắt, giữ mô tả", () => {
    const d = cloneDraft(agent(), "(bản sao)");
    expect(d).toMatchObject({ key: "", nameVi: "Hoá đơn (bản sao)", enabled: false });
    expect(d.description).toBe(agent().description);
  });

  test("diffDrafts chỉ liệt kê trường khác nhau, cắt ở 8 dòng", () => {
    const a = fromAgent(agent());
    const rows = diffDrafts({ ...a, prompt: "mới", enabled: false }, a, (k) => k);
    expect(rows.rows.map((r) => r.path)).toEqual(["editor.field.prompt", "editor.field.enabled"]);
    expect(rows.more).toBe(0);
  });
});

describe("parseConflict", () => {
  test("đọc current + updated_at; mã khác ⇒ null", () => {
    const err = { code: "VERSION_CONFLICT", details: { current: { version: 5 }, updated_at: "x" } };
    expect(parseConflict(err)).toEqual({ current: { version: 5 }, updatedAt: "x" });
    expect(parseConflict({ code: "NOT_FOUND" })).toBeNull();
  });
});
