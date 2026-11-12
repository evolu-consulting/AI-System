// CR-122 · E1 · FLOW2-FR-01/02/15 · int (Hono thật `defsRoutes` + DB thật): lưu def có `trigger` + `app` (trường gốc của body, như
// admin-web gửi), GET trả lại; stage giữ `outcome` + `next_step`; sai luật FlowDef ⇒ 422 `PROCESS_DEF_INVALID` + `paths`; PUT không
// gửi `trigger` ⇒ giữ nguyên; `trigger_event` sinh để bộ điều phối chọn flow.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { MODULES } from "@ai/contracts/modules";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { nodeConfigRegistry } from "../../packs/kit/public";
import type { ProcessDeps } from "../core/ports";
import { defsRoutes } from "./defs.routes";

const X = tenantId(1231);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  A: { userId: userId(1231), tenantId: X, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let id = "";
let contractsOff = false; // N2 · tắt tính năng `contracts-write` của công ty giữa chừng (đường chạy tay)

async function call(method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": "A" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}

const stage = (key: string, step: number, extra: object = {}) => ({
  key,
  name: key.toUpperCase(),
  step,
  executor: { kind: "set", values: [{ key: "x", from: { const: "1" } }] },
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: "# x",
    required_sections: ["x"],
    fields: [{ key: "x", type: "string", required: false }],
  },
  after: { kind: "auto", branch: [] },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
  ...extra,
});
const trigger = {
  event: "contract.submitted",
  when: { op: "and", conds: [{ fact: "total_value", op: "ge", value: 1000 }] },
};
const body = (o: object = {}) => ({
  key: "e1-flow-hd",
  name: "Duyệt HĐ lớn",
  description: "",
  input_hint: "",
  run_group_ids: [],
  stages: [
    stage("dau", 0, { next_step: 2 }),
    stage("giua", 1),
    stage("xong", 2, { outcome: "approved" }),
  ],
  token_budget: null,
  enabled: true,
  sources: [],
  inputs: [],
  trigger,
  app: "contracts",
  ...o,
});

beforeAll(async () => {
  // Sổ validator node là singleton của process: test khác cùng process (mountPacks / esignModule) đăng ký validator giữ kết nối DB
  // đã đóng ⇒ 500 CONNECTION_ENDED. Test này kiểm luật def, không kiểm cấu hình Ký số (đã có esign-node.int) ⇒ gỡ.
  nodeConfigRegistry.clear("contracts.esign");
  nodeConfigRegistry.clear("contracts-esign-send");
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1231', 'X')`;
  await users(o, X, 1, { from: 1231 });
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO[c.req.header("x-who") ?? ""] as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return c.json(m.body, m.status);
  });
  // N1 · cache cấu hình giả: `contracts-write` cấp cho X, `contracts.community` không ⇒ node Hiện bài tắt.
  const config = {
    catalog: async () => ({
      features: [
        { id: "f1", key: "contracts-write", status: "on" },
        { id: "f2", key: "contracts.community", status: "on" },
      ],
      entitled: new Set(contractsOff ? [] : [`${X}:f1`]),
      grantGroups: new Map(),
    }),
    user: async () => undefined,
  };
  // Cổng gói giả: tool gửi ký khả dụng cho công ty (cụm Ký số cần stage tool hợp lệ).
  const packTools = {
    available: async () => [
      {
        key: "contracts-esign-send",
        sideEffect: false,
        params: [
          { name: "contract_id", type: "string", required: true },
          { name: "company_signers", type: "text", required: false },
        ],
      },
    ],
  };
  app.route("/", defsRoutes({ db, packTools, start: {}, config } as unknown as ProcessDeps));
}, 180_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-122 E1 · lưu def có trigger", () => {
  it("POST + GET: trigger/app/outcome/next_step lưu và đọc lại, trigger_event sinh", async () => {
    const c = await call("POST", "/process-defs", body());
    expect(c.status).toBe(201);
    id = c.json.id;
    const g = await call("GET", `/process-defs/${c.json.id}`);
    expect(g.status).toBe(200);
    expect(g.json.trigger).toEqual(trigger);
    expect(g.json.app).toBe("contracts");
    expect(g.json.stages[0].next_step).toBe(2);
    expect(g.json.stages[2].outcome).toBe("approved");
    const [r] = await o<
      { e: string }[]
    >`select trigger_event as e from hub.process_defs where id = ${c.json.id}`;
    expect(r?.e).toBe("contract.submitted");
  });

  it("PUT sai luật FlowDef ⇒ 422 + paths, không ghi, PUT không gửi trigger ⇒ giữ nguyên", async () => {
    const cur = await call("GET", `/process-defs/${id}`);
    const bad = await call("PUT", `/process-defs/${id}`, {
      ...body({ stages: [stage("dau", 0, { outcome: "shown" })] }),
      version: cur.json.version,
    });
    expect(bad.status).toBe(422);
    expect(bad.json.error?.code ?? bad.json.code).toBe("PROCESS_DEF_INVALID");
    expect(JSON.stringify(bad.json)).toContain("stages.0.outcome");
    const { trigger: _t, app: _a, ...noTrigger } = body({ name: "Đổi tên" });
    const ok = await call("PUT", `/process-defs/${id}`, {
      ...noTrigger,
      version: cur.json.version,
    });
    expect(ok.status).toBe(200);
    expect(ok.json.name).toBe("Đổi tên");
    expect(ok.json.trigger).toEqual(trigger);
    expect(ok.json.app).toBe("contracts");
  });

  it("N1 · bước là node của tính năng đã tắt ⇒ 422 FLOW_NODE_FEATURE_OFF nêu tính năng, node bật ⇒ lưu được", async () => {
    const cur = await call("GET", `/process-defs/${id}`);
    const withNode = (node: string) => {
      const mid = nodeStages("dau", 0, node);
      return {
        ...body({
          stages: [...mid, stage("xong", mid.length, { outcome: "approved" })],
        }),
        version: cur.json.version,
      };
    };
    const off = await call("PUT", `/process-defs/${id}`, withNode("community.show-post"));
    expect([off.status, off.json.error?.code ?? off.json.code]).toEqual([
      422,
      "FLOW_NODE_FEATURE_OFF",
    ]);
    expect(JSON.stringify(off.json)).toContain("contracts.community");
    const on = await call("PUT", `/process-defs/${id}`, withNode("contracts.esign"));
    expect(on.status).toBe(200);
    expect(on.json.stages[0].node).toBe("contracts.esign");
  });
});

// Stage tool của node cần đủ tham số bắt buộc của tool (như defs-node-config.int.test).
const toolArgs = (ex: object): object =>
  (ex as { kind: string }).kind === "tool"
    ? {
        ...ex,
        args: {
          contract_id: { from: "const", value: "x" },
          company_signers: { from: "const", value: `user:${userId(1231)}` }, // CEO-review #2 · người ký thật của công ty
        },
      }
    : ex;

/** Stage(s) của một node: node nhiều stage (vd Ký số) ⇒ trọn cụm liên tiếp lấy từ khai báo node trong MODULES (một nguồn). */
const nodeStages = (key: string, step: number, node: string) => {
  const decl = MODULES.flatMap((m) => m.nodes).find((n) => n.key === node);
  const decls = decl && decl.stages.length > 1 ? decl.stages : [undefined];
  return decls.map((d, i) =>
    stage(i === 0 ? key : `${key}-${i}`, step + i, {
      node,
      // `real_action` giữ false: luật REAL_ACTION (bước thật phải đứng sau bước duyệt) không thuộc ý các ca này.
      ...(d
        ? {
            executor: toolArgs(d.executor),
            // Stage kế trong cụm nhận lại dữ kiện đầu vào của node từ stage trước ⇒ mỗi stage ra lại các trường đó.
            output: {
              filename: `${key}-${i}.md`,
              template: "# x",
              required_sections: ["x"],
              fields: (decl?.inputs ?? []).map((f) => ({
                key: f.key,
                type: f.type,
                required: false,
              })),
            },
          }
        : {}),
    }),
  );
};

/** Stage `set` chỉ có một field `fkey` (ghi hằng) — đủ để làm "bước trước có trường fkey". */
const withField = (key: string, step: number, fkey: string, ftype: string, extra: object = {}) =>
  stage(key, step, {
    executor: {
      kind: "set",
      values: [{ key: fkey, from: { const: ftype === "date" ? "2026-01-01" : "1" } }],
    },
    output: {
      filename: `${key}.md`,
      template: "# x",
      required_sections: ["x"],
      fields: [{ key: fkey, type: ftype, required: false }],
    },
    ...extra,
  });
const edgeBody = (version: number, fkey: string, ftype: string, node: string) => {
  const mid = nodeStages("giua", 1, node);
  return {
    ...body({
      stages: [
        withField("dau", 0, fkey, ftype),
        ...mid,
        stage("xong", 1 + mid.length, { outcome: "approved" }),
      ],
    }),
    // CR-122 · lát A: "Bắt đầu khi" cấp bản ghi + dữ kiện cho MỌI cạnh ⇒ def kiểm cạnh KHÔNG có trigger (null ⇒ xoá), để trường
    // `contract_id`/`date` chỉ đến từ bước trước.
    trigger: null,
    app: null,
    version,
  };
};

describe("CR-122 N2 · cạnh lệch giao diện + chạy tay", () => {
  it("thiếu trường BẮT BUỘC ⇒ 422 FLOW_EDGE_MISSING nêu cạnh + trường, không ghi, đủ trường ⇒ lưu, không warnings", async () => {
    const cur = await call("GET", `/process-defs/${id}`);
    const bad = await call(
      "PUT",
      `/process-defs/${id}`,
      edgeBody(cur.json.version, "x", "string", "contracts.esign"),
    );
    expect([bad.status, bad.json.error?.code ?? bad.json.code]).toEqual([422, "FLOW_EDGE_MISSING"]);
    expect(JSON.stringify(bad.json)).toContain("contract_id");
    expect((await call("GET", `/process-defs/${id}`)).json.version).toBe(cur.json.version);
    const ok = await call(
      "PUT",
      `/process-defs/${id}`,
      edgeBody(cur.json.version, "contract_id", "string", "contracts.esign"),
    );
    expect(ok.status).toBe(200);
    expect(ok.json.warnings).toBeUndefined();
  });

  it("sai kiểu (field `date` là chuỗi, Hẹn giờ cần date) ⇒ vẫn lưu, response có warnings", async () => {
    const cur = await call("GET", `/process-defs/${id}`);
    const r = await call(
      "PUT",
      `/process-defs/${id}`,
      edgeBody(cur.json.version, "date", "string", "core.wait-until"),
    );
    expect(r.status).toBe(200);
    // Cạnh còn có tên hiển thị + nhãn (from_name/to_name/labels) ⇒ so phần lõi.
    expect(r.json.warnings).toHaveLength(1);
    expect(r.json.warnings[0]).toMatchObject({
      from: "dau",
      to: "giua",
      missing: [],
      typeMismatch: [{ key: "date", expected: "date", got: "string" }],
    });
  });

  it("chạy tay: node của tính năng đã tắt ⇒ 422 FLOW_NODE_FEATURE_OFF, không mở lượt", async () => {
    const cur = await call("GET", `/process-defs/${id}`);
    const saved = await call(
      "PUT",
      `/process-defs/${id}`,
      edgeBody(cur.json.version, "contract_id", "string", "contracts.esign"),
    );
    expect(saved.status).toBe(200);
    contractsOff = true;
    try {
      const r = await call("POST", `/process-defs/${id}/run`, { input: "x" });
      expect([r.status, r.json.error?.code ?? r.json.code]).toEqual([422, "FLOW_NODE_FEATURE_OFF"]);
      expect(JSON.stringify(r.json)).toContain("contracts-write");
    } finally {
      contractsOff = false;
    }
  });
});
