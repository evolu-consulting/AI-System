// dify-demo-flow · unit `dify-register`: cờ, kế hoạch không chứa key, chính sách QC-TC-01 trong DSL (chạy Python thật nếu có),
// và `--apply` hai lần trên admin giả có trạng thái (lần 2 không ghi gì, key không xuất hiện trong output).
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "./dify-register";
import {
  buildRegisterPlan,
  formatRegisterPlan,
  HMD_COMMAND,
  HMD_WORKFLOW,
  parseRegisterArgs,
  type RegisterArgs,
} from "./dify-register.rules";

const APP = "3f2b8c1e-1111-4222-8333-444455556666";
const BASE = "https://dify.example/v1";
const KEY = ["app", `UNIT${crypto.randomUUID().replaceAll("-", "")}`].join("-");
const argv = (...x: string[]) => [
  "--tenant",
  "demo",
  "--app-id",
  APP,
  "--base-url",
  `${BASE}/`,
  ...x,
];
const DSL = join(import.meta.dir, "../../../deploy/prod-sohoptac2/dify/han-muc-duyet.yml");

describe("dify-register · cờ + kế hoạch", () => {
  it("parse: bắt buộc tenant/app-id/base-url, chuẩn hoá base-url, cờ lạ/URL xấu → lỗi", () => {
    const a = parseRegisterArgs(argv("--apply")) as RegisterArgs;
    expect(a).toMatchObject({
      apply: true,
      tenant: "demo",
      appId: APP,
      baseUrl: BASE,
      group: null,
    });
    expect("error" in parseRegisterArgs(["--tenant", "demo"])).toBe(true);
    expect("error" in parseRegisterArgs(argv("--key", "x"))).toBe(true);
    expect(
      "error" in parseRegisterArgs([...argv().slice(0, 4), "--base-url", "https://u:p@h/v1"]),
    ).toBe(true);
    expect(
      "error" in parseRegisterArgs([...argv().slice(0, 2), "--app-id", "../x", "--base-url", BASE]),
    ).toBe(true);
  });

  it("plan khớp workflow/command; bản in không chứa key", () => {
    const a = parseRegisterArgs(argv()) as RegisterArgs;
    const p = buildRegisterPlan(a);
    expect(p.workflows[0]).toMatchObject({
      dify_app_id: APP,
      base_url: BASE,
      output_field: "note",
    });
    expect(p.commands[0]?.output.field).toBe(HMD_WORKFLOW.output_field ?? undefined);
    const mapped = Object.keys(HMD_COMMAND.input_map).sort();
    expect(mapped).toEqual(HMD_WORKFLOW.input_schema.map((i) => i.name).sort());
    expect(formatRegisterPlan(p, a)).not.toContain(KEY);
  });
});

type Doc = { workflow?: { graph: { nodes: { data: { type: string; code?: string } }[] } } };
function dslCode(): string {
  const doc = Bun.YAML.parse(readFileSync(DSL, "utf8")) as Doc;
  const node = doc.workflow?.graph.nodes.find((n) => n.data.type === "code");
  return node?.data.code ?? "";
}
const py = Bun.which("python") ?? Bun.which("python3");

describe("han-muc-duyet.yml · chính sách QC-TC-01", () => {
  it("DSL version 0.6.0, mode workflow, không có node LLM", () => {
    const text = readFileSync(DSL, "utf8");
    expect(text).toMatch(/^version: 0\.6\.0$/m);
    expect(text).toMatch(/^ {2}mode: workflow$/m);
    expect(text).not.toMatch(/type: llm/);
  });

  const cases: [number, string, string[]][] = [
    [30_000_000, "Mua", ["Trưởng phòng Kinh doanh"]],
    [50_000_000, "Bán", ["Trưởng phòng Kinh doanh", "Kế toán trưởng"]],
    [500_000_000, "Mua", ["Trưởng phòng Kinh doanh", "Kế toán trưởng"]],
    [600_000_000, "Mua", ["Trưởng phòng Kinh doanh", "Kế toán trưởng", "Giám đốc ký"]],
    [
      2_000_000_001,
      "Giới thiệu",
      ["Trưởng phòng Kinh doanh", "Kế toán trưởng", "Giám đốc ký", "Ý kiến Phòng Pháp chế"],
    ],
  ];
  it.skipIf(!py)("code node: 5 mốc giá trị + giá trị không hợp lệ", () => {
    const run = (v: number, t: string): { approvers: string[]; level: string; note: string } => {
      const prog = `${dslCode()}\nimport json,sys\nprint(json.dumps(main(${v}, ${JSON.stringify(t)}, 'ACME'), ensure_ascii=False))`;
      const p = Bun.spawnSync([py as string, "-X", "utf8", "-c", prog]);
      expect(p.exitCode).toBe(0);
      return JSON.parse(new TextDecoder().decode(p.stdout));
    };
    for (const [v, t, want] of cases) {
      const r = run(v, t);
      expect(r.approvers).toEqual(want);
      expect(r.note).toContain(want[want.length - 1] as string);
      expect(r.note).toContain("ACME");
    }
    expect(run(600_000_000, "Mua").note).toContain("600.000.000");
    expect(run(0, "Mua").approvers).toEqual([]);
  });
});

// ---------- admin giả có trạng thái ----------
type Obj = Record<string, unknown>;
let server: ReturnType<typeof Bun.serve>;
const writes: string[] = [];
const bodies: string[] = [];
const store = {
  secrets: new Map<string, Obj>(),
  wf: new Map<string, Obj>(),
  cmd: new Map<string, Obj>(),
  feat: new Map<string, Obj>(),
  grants: new Set<string>(),
  ents: new Set<string>(),
};
let seq = 0;
const nid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const G1 = "00000000-0000-4000-8000-0000000000a1";
const json = (b: unknown, status = 200) => Response.json(b, { status });
const byQ = (m: Map<string, Obj>, field: string, q: string | null) => ({
  items: [...m.values()].filter((x) => x[field] === q),
});

type Ctx = { u: URL; body: Obj; m: RegExpExecArray };
type Route = [method: string, re: RegExp, h: (c: Ctx) => Response];
const q = (c: Ctx) => c.u.searchParams.get("q");
const create = (map: Map<string, Obj>, make: (id: string, b: Obj) => Obj) => (c: Ctx) => {
  const id = nid();
  map.set(id, make(id, c.body));
  return json({ id }, 201);
};
const catalogRow = (id: string, b: Obj): Obj => {
  const { secret_id, workflow_id, feature_ids: _f, ...rest } = b;
  return {
    id,
    version: 1,
    ...rest,
    secret: secret_id ? { id: secret_id } : undefined,
    workflow: workflow_id ? { id: workflow_id } : undefined,
  };
};
const ROUTES: Route[] = [
  ["POST", /^\/auth\/login$/, () => json({ status: "authenticated", access_token: "t" })],
  ["GET", /^\/admin\/tenants$/, (c) => json({ items: [{ id: "tenant-1", key: q(c) }] })],
  ["POST", /^\/admin\/secrets$/, create(store.secrets, (id, b) => ({ id, name: b.name }))],
  ["GET", /^\/admin\/secrets$/, (c) => json(byQ(store.secrets, "name", q(c)))],
  ["POST", /^\/admin\/features$/, create(store.feat, (id, b) => ({ id, key: b.key }))],
  [
    "GET",
    /^\/admin\/features$/,
    (c) =>
      q(c) === "contracts-read"
        ? json({ items: [{ id: "feat-cr", key: "contracts-read" }] })
        : json(byQ(store.feat, "key", q(c))),
  ],
  [
    "PUT",
    /^\/admin\/features\/[^/]+\/entitlements\/.+$/,
    (c) => {
      store.ents.add(c.u.pathname);
      return json({});
    },
  ],
  [
    "GET",
    /^\/admin\/features\/[^/]+\/entitlements$/,
    () => json({ items: store.ents.size ? [{ tenant_id: "tenant-1" }] : [] }),
  ],
  ["POST", /^\/admin\/workflows$/, create(store.wf, catalogRow)],
  ["POST", /^\/admin\/commands$/, create(store.cmd, catalogRow)],
  ["GET", /^\/admin\/workflows$/, (c) => json(byQ(store.wf, "key", q(c)))],
  ["GET", /^\/admin\/commands$/, (c) => json(byQ(store.cmd, "name", q(c)))],
  ["GET", /^\/admin\/workflows\/([^/]+)$/, (c) => json(store.wf.get(c.m[1] as string) ?? {})],
  ["GET", /^\/admin\/commands\/([^/]+)$/, (c) => json(store.cmd.get(c.m[1] as string) ?? {})],
  [
    "POST",
    /^\/admin\/grants$/,
    (c) => {
      store.grants.add(String(c.body.group_id));
      return json({ id: nid() }, 201);
    },
  ],
  [
    "GET",
    /^\/admin\/grants$/,
    (c) => {
      const ids = c.u.searchParams.get("feature_id") === "feat-cr" ? [G1] : [...store.grants];
      return json({ items: ids.map((id) => ({ subject: { type: "group", group: { id } } })) });
    },
  ],
];

async function fake(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const body = req.method === "GET" ? {} : ((await req.json().catch(() => ({}))) as Obj);
  if (req.method !== "GET" && u.pathname !== "/auth/login") {
    writes.push(`${req.method} ${u.pathname}`);
    bodies.push(JSON.stringify(body));
  }
  for (const [method, re, h] of ROUTES) {
    const m = re.exec(u.pathname);
    if (method === req.method && m) return h({ u, body, m });
  }
  return json({ items: [] });
}

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: fake });
});
afterAll(() => server.stop(true));

describe("dify-register · --apply idempotent (admin giả)", () => {
  const env = () => ({
    DIFY_APP_KEY: KEY,
    SEED_ADMIN_USERNAME: "admin",
    SEED_ADMIN_PASSWORD: "pw",
    ADMIN_API_URL: `http://localhost:${server.port}`,
  });
  async function run(a: string[], e: Record<string, string | undefined>) {
    const out: string[] = [];
    const l = spyOn(console, "log").mockImplementation(
      (...x: unknown[]) => void out.push(x.join(" ")),
    );
    const er = spyOn(console, "error").mockImplementation(
      (...x: unknown[]) => void out.push(x.join(" ")),
    );
    try {
      return { code: await main(a, e), out: out.join("\n") };
    } finally {
      l.mockRestore();
      er.mockRestore();
    }
  }

  it("dry-run không gọi mạng; thiếu DIFY_APP_KEY khi --apply → lỗi nêu tên biến", async () => {
    const d = await run(argv(), {});
    expect(d.code).toBe(0);
    expect(writes).toHaveLength(0);
    const r = await run(argv("--apply"), { ...env(), DIFY_APP_KEY: "" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("DIFY_APP_KEY");
  });

  it("lần 1 tạo secret+workflow+command+grant; lần 2 không ghi; key không lộ ra output/log/ghi trừ body secret", async () => {
    const r1 = await run(argv("--apply"), env());
    expect(r1.code).toBe(0);
    expect(store.wf.size).toBe(1);
    expect(store.cmd.size).toBe(1);
    expect([...store.wf.values()][0]).toMatchObject({
      dify_app_id: APP,
      base_url: BASE,
      side_effect: false,
    });
    expect(store.grants.has(G1)).toBe(true);
    const secretBodies = bodies.filter((b) => b.includes(KEY));
    expect(secretBodies).toHaveLength(1);
    expect(r1.out).not.toContain(KEY);
    const before = writes.length;
    const r2 = await run(argv("--apply"), env());
    expect(r2.code).toBe(0);
    expect(writes.length).toBe(before);
    expect(r2.out).not.toContain(KEY);
  });
});
