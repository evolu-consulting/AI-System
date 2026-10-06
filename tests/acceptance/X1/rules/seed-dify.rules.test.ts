// X1-AC16 · X1-AC17 · ADM-FR-21 · luật thuần seed Dify (plan §5.2, §5.3, §5.5): danh sách trắng biến env, plan/dry-run
// không chứa key, patch chỉ trường khác, input map đúng cú pháp K5. Key giả sinh LÚC CHẠY (P1), không ghi chuỗi giống key.
// Nạp động (P7) ⇒ đỏ "Cannot find module" tới khi S1 xong.
import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { ArgsSchema, InputMapSchema } from "@ai/contracts";
import { type Loose, loadSeedRules } from "../_modules";

const APPS = ["chatbot", "translate", "gmail-summary", "email-reply", "screenshot-ask"] as const;
const ENV_NAMES = {
  chatbot: "DIFY_KEY_CHATBOT",
  translate: "DIFY_KEY_TRANSLATE",
  "gmail-summary": "DIFY_KEY_GMAIL",
  "email-reply": "DIFY_KEY_EMAILREPLY",
  "screenshot-ask": "DIFY_KEY_SCREENSHOTASK",
} as const;
/** Key giả dạng Dify, sinh lúc chạy (AC18 không bắt vì không có trong file). */
const fakeKey = () =>
  ["app", randomBytes(18).toString("base64url").replace(/[-_]/g, "Q")].join("-");
const API = "http://127.0.0.1:59999/v1";

function envText(keys: Record<string, string>, extra: Record<string, string> = {}): string {
  const lines = [`DIFY_API_URL=${API}`];
  for (const [k, v] of Object.entries({ ...keys, ...extra })) lines.push(`${k}=${v}`);
  return ["# file .env giả cho test", ...lines, ""].join("\n");
}
function allKeys(): Record<string, string> {
  return Object.fromEntries(Object.values(ENV_NAMES).map((n) => [n, fakeKey()]));
}
/** Tìm đệ quy object đầu tiên thoả `pred` (cấu trúc SeedPlan chưa chốt kiểu; chỉ dựa vào trường API snake_case). */
function findDeep(v: unknown, pred: (o: Loose) => boolean): Loose | undefined {
  if (v === null || typeof v !== "object") return undefined;
  if (!Array.isArray(v) && pred(v as Loose)) return v as Loose;
  for (const x of Array.isArray(v) ? v : Object.values(v as Loose)) {
    const hit = findDeep(x, pred);
    if (hit) return hit;
  }
  return undefined;
}
async function planFor(argv: string[] = []): Promise<{ plan: Loose; text: string }> {
  const r = await loadSeedRules();
  const args = r.parseSeedArgs(argv);
  expect(args.error).toBeUndefined();
  const plan = r.buildSeedPlan(args, API);
  return { plan, text: r.formatPlan(plan) as string };
}

describe("X1-AC16 · bảng app + danh sách trắng env (plan §5.2)", () => {
  it("X1-AC16 · SEED_APPS đúng 5 app theo thứ tự; ENV_KEY đúng map", async () => {
    const r = await loadSeedRules();
    expect([...r.SEED_APPS]).toEqual([...APPS]);
    expect(r.ENV_KEY).toEqual(ENV_NAMES);
  });

  it("X1-AC16 · parseSeedEnv chỉ lấy DIFY_API_URL + ENV_KEY[app]; bỏ biến console/agent/khác (giá trị bẫy không lọt ra)", async () => {
    const r = await loadSeedRules();
    const keys = allKeys();
    const trap = `TRAP-${randomBytes(12).toString("hex")}`;
    const text = envText(keys, {
      DIFY_CONSOLE_PASSWORD: trap,
      DIFY_EMAIL: `${trap}@x.test`,
      DIFY_AGENT_API_KEY: `${trap}-agent`,
      DIFY_KEY_WEBCONTEXT: `${trap}-web`,
    });
    const out = r.parseSeedEnv(text, ["translate", "chatbot"]);
    expect(out.ok).toBe(true);
    expect(out.apiUrl).toBe(API);
    expect([...out.keys.keys()].sort()).toEqual(["chatbot", "translate"]);
    expect(out.keys.get("translate")).toBe(keys.DIFY_KEY_TRANSLATE);
    expect(out.keys.get("chatbot")).toBe(keys.DIFY_KEY_CHATBOT);
    const dump = JSON.stringify({ ...out, keys: [...out.keys.entries()] });
    expect(dump).not.toContain(trap);
    expect(dump).not.toContain(keys.DIFY_KEY_GMAIL as string);
  });

  it("X1-AC17 · thiếu key của app chọn ⇒ {ok:false, missing:['DIFY_KEY_TRANSLATE']} (chỉ tên, không giá trị)", async () => {
    const r = await loadSeedRules();
    const keys = allKeys();
    const { DIFY_KEY_TRANSLATE: _t, ...rest } = keys;
    const out = r.parseSeedEnv(envText(rest), ["translate", "chatbot"]);
    expect(out).toEqual({ ok: false, missing: ["DIFY_KEY_TRANSLATE"] });
    // app không chọn thì thiếu key cũng không sao
    expect(r.parseSeedEnv(envText(rest), ["chatbot"]).ok).toBe(true);
  });

  it("X1-AC17 · thiếu DIFY_API_URL ⇒ missing nêu DIFY_API_URL", async () => {
    const r = await loadSeedRules();
    const text = Object.entries(allKeys())
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    const out = r.parseSeedEnv(text, ["translate"]);
    expect(out.ok).toBe(false);
    expect(out.missing).toContain("DIFY_API_URL");
  });
});

describe("X1-AC17 · parseSeedArgs (plan §5.1)", () => {
  it("X1-AC17 · --apps foo ⇒ {error} nêu 'foo'; --apps translate,chatbot hợp lệ", async () => {
    const r = await loadSeedRules();
    const bad = r.parseSeedArgs(["--apps", "translate,foo"]);
    expect(typeof bad.error).toBe("string");
    expect(bad.error).toContain("foo");
    expect(r.parseSeedArgs(["--apps", "translate,chatbot"]).error).toBeUndefined();
  });

  it("X1-AC16 · mặc định dry-run (khác --apply); mặc định tenant acme, group dify-demo", async () => {
    const r = await loadSeedRules();
    const dry = r.parseSeedArgs([]);
    const apply = r.parseSeedArgs(["--apply"]);
    expect(dry.error).toBeUndefined();
    expect(apply.error).toBeUndefined();
    expect(JSON.stringify(dry)).not.toBe(JSON.stringify(apply));
    expect(JSON.stringify(dry)).toContain("acme");
    expect(JSON.stringify(dry)).toContain("dify-demo");
  });
});

describe("X1-AC16 · buildSeedPlan / formatPlan (plan §5.3, §5.5)", () => {
  it("X1-AC16 · plan đủ 5 workflow dify-* (dify-chatbot app_type agent), tất cả side_effect=false; 4 command", async () => {
    const { plan, text } = await planFor();
    for (const a of APPS) {
      const w = findDeep(plan, (o) => o.key === `dify-${a}` && "app_type" in o);
      expect(w).toBeDefined();
      expect(w?.side_effect ?? false).toBe(false);
      expect(text).toContain(`dify-${a}`);
    }
    expect(findDeep(plan, (o) => o.key === "dify-chatbot" && "app_type" in o)?.app_type).toBe(
      "agent",
    );
    for (const name of ["translate", "summary", "reply", "ask-image"]) {
      expect(findDeep(plan, (o) => o.name === name && Array.isArray(o.args))).toBeDefined();
      expect(text).toContain(name);
    }
  });

  it("X1-AC16 · input map translate đúng §5.3 (K5): args [lang default 'vi'; text rest fallback selection], map text←arg text, target_lang←arg lang", async () => {
    const { plan } = await planFor();
    const cmd = findDeep(plan, (o) => o.name === "translate" && Array.isArray(o.args));
    expect(cmd).toBeDefined();
    expect(ArgsSchema.safeParse(cmd?.args).success).toBe(true);
    expect(InputMapSchema.safeParse(cmd?.input_map).success).toBe(true);
    expect(cmd?.args).toHaveLength(2);
    expect(cmd?.args[0]).toMatchObject({ name: "lang", default: "vi" });
    expect(cmd?.args[1]).toMatchObject({ name: "text", rest: true, fallback: "selection" });
    expect(cmd?.input_map).toEqual({
      text: { source: "arg", value: "text" },
      target_lang: { source: "arg", value: "lang" },
    });
    expect(cmd?.output).toEqual({ field: "text", render: "markdown" });
  });

  it("X1-AC16 · summary/reply/ask-image theo §5.3 (const subject/sender; attachment cho image)", async () => {
    const { plan } = await planFor();
    const sum = findDeep(plan, (o) => o.name === "summary" && Array.isArray(o.args));
    expect(sum?.input_map).toEqual({
      email_body: { source: "arg", value: "text" },
      subject: { source: "const", value: "(không tiêu đề)" },
      sender: { source: "const", value: "(dán từ chat)" },
    });
    expect(sum?.output).toEqual({ field: "summary", render: "markdown" });
    const reply = findDeep(plan, (o) => o.name === "reply" && Array.isArray(o.args));
    expect(reply?.output).toEqual({ field: "text", render: "markdown" });
    const img = findDeep(plan, (o) => o.name === "ask-image" && Array.isArray(o.args));
    expect(img?.input_map).toMatchObject({
      image: { source: "attachment" },
      question: { source: "arg", value: "question" },
    });
    expect(img?.args[0]).toMatchObject({ name: "question", rest: true });
  });

  it("X1-AC16 · plan + bản in dry-run không chứa key (thô/base64/hex) — key không phải đầu vào của buildSeedPlan", async () => {
    const r = await loadSeedRules();
    const keys = allKeys();
    const env = r.parseSeedEnv(envText(keys), [...APPS]);
    expect(env.ok).toBe(true);
    const { plan, text } = await planFor(["--apply"]);
    const blob = `${JSON.stringify(plan)}\n${text}`;
    for (const v of Object.values(keys)) {
      for (const f of [
        v,
        Buffer.from(v).toString("base64"),
        Buffer.from(v).toString("base64url"),
        Buffer.from(v).toString("hex"),
      ])
        expect(blob).not.toContain(f);
    }
  });
});

describe("X1-AC16 · workflowPatch / commandPatch (idempotent, X1-R14)", () => {
  const wf: Loose = {
    key: "dify-translate",
    name: "Dịch (Dify)",
    description: "Dịch văn bản qua Dify cho bản demo X1",
    app_type: "workflow",
    base_url: API,
    input_schema: [{ name: "text", type: "text", required: true, description: "Văn bản cần dịch" }],
    output_field: "text",
    side_effect: false,
  };
  const cmd: Loose = {
    name: "translate",
    args: [
      { name: "lang", required: false, rest: false, default: "vi" },
      { name: "text", required: true, rest: true, fallback: "selection" },
    ],
    input_map: { text: { source: "arg", value: "text" } },
    output: { field: "text", render: "markdown" },
  };

  it("X1-AC16 · giống ⇒ null; khác 1 trường ⇒ chỉ trường đó", async () => {
    const r = await loadSeedRules();
    expect(r.workflowPatch(wf, { ...wf })).toBeNull();
    expect(r.workflowPatch(wf, { ...wf, description: "Mô tả mới đủ dài cho demo X1" })).toEqual({
      description: "Mô tả mới đủ dài cho demo X1",
    });
    expect(r.commandPatch(cmd, structuredClone(cmd))).toBeNull();
    const out = { field: "summary", render: "markdown" };
    expect(r.commandPatch(cmd, { ...cmd, output: out })).toEqual({ output: out });
  });
});
