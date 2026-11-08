// CR-126 · cr126-requests-mine · int (Hono thật + DB thật, role hub_api): `GET /processes/requests/mine` chỉ trả yêu cầu (bắt đầu bằng phiếu,
// lượt gốc) do CHÍNH người gọi gửi — tên theo `request_title`, nhóm trạng thái một chữ, người đang chờ; người khác / công ty khác không thấy.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { manualStartRoutes } from "./manual-start.routes";

const X = tenantId(1461);
const Y = tenantId(1462);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  A: { userId: userId(1461), tenantId: X, role: "member" },
  B: { userId: userId(1462), tenantId: X, role: "member" },
  O: { userId: userId(1463), tenantId: Y, role: "tenant_admin" },
};
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let mineWaiting = "";
let mineDone = "";

const snap = (node: string) => ({
  key: "k",
  name: "Đề xuất",
  stages: [
    {
      key: "b0",
      name: "b",
      node,
      step: 0,
      executor: { kind: "set", values: [] },
      after: { kind: "auto", branch: [] },
    },
  ],
});

async function seedRun(p: {
  tid: string;
  starter: string;
  def: string;
  conv: string;
  status: string;
  title: string;
  node?: string;
}) {
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
      conversation_id, flow_id, current_step, current_stage_idx, status, inputs)
    values (${p.tid}, ${p.def}, 1, ${o.json(snap(p.node ?? "core.start-form") as never)}, ${p.starter}, 'admin', 'x', ${p.conv},
      gen_random_uuid(), 0, 0, ${p.status}, ${o.json([{ key: "request_title", type: "text", text: p.title }] as never)})
    returning id::text as id`;
  return r?.id as string;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1461', 'X'), (${Y}, 't1462', 'Y')`;
  await users(o, X, 2, { from: 1461 });
  await users(o, Y, 1, { from: 1463 });
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${X}, 'rm', 'rm', ${o.json([{ key: "b0" }])}) returning id::text as id`;
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${X}, ${WHO.A?.userId as string}, 'c', 'c') returning id::text as id`;
  const a = WHO.A?.userId as string;
  const base = { tid: X, def: d?.id as string, conv: c?.id as string };
  mineWaiting = await seedRun({
    ...base,
    starter: a,
    status: "waiting_review",
    title: "Mua laptop",
  });
  mineDone = await seedRun({ ...base, starter: a, status: "done", title: "Mua ghế" });
  await seedRun({
    ...base,
    starter: a,
    status: "running",
    title: "Không phải phiếu",
    node: "core.set",
  });
  await seedRun({ ...base, starter: WHO.B?.userId as string, status: "running", title: "Của B" });
  const deps = {
    db,
    config: {
      user: async () => ({ active: true, groupIds: new Set<string>() }),
      poll: async () => {},
    },
    launcher: { kick: async () => {} },
    log: { warn: () => {}, info: () => {}, error: () => {} },
    now: () => new Date(),
    runsPerTenant: 100,
    postThread: async () => {},
  } as unknown as ProcessDeps;
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO[c.req.header("x-who") ?? ""] as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  app.route("/", manualStartRoutes(deps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const mine = async (who: string) => {
  const r = await app.request("/processes/requests/mine", { headers: { "x-who": who } });
  return {
    status: r.status,
    items: ((await r.json()) as { items: Record<string, unknown>[] }).items,
  };
};

describe("CR-126 · GET /processes/requests/mine", () => {
  it("người gửi thấy đúng yêu cầu phiếu của mình, kèm tên + nhóm trạng thái", async () => {
    const r = await mine("A");
    expect(r.status).toBe(200);
    expect(r.items.map((i) => i.run_id).sort()).toEqual([mineWaiting, mineDone].sort());
    expect(r.items.find((i) => i.run_id === mineWaiting)).toMatchObject({
      title: "Mua laptop",
      word: "waiting",
    });
    expect(r.items.find((i) => i.run_id === mineDone)).toMatchObject({
      title: "Mua ghế",
      word: "done",
      waiting_for: null,
    });
  });

  it("chặn đọc chéo: người khác cùng công ty và công ty khác không thấy yêu cầu của A", async () => {
    const ids = [mineWaiting, mineDone];
    expect(
      (await mine("B")).items.map((i) => i.run_id).filter((i) => ids.includes(i as string)),
    ).toEqual([]);
    expect((await mine("O")).items).toEqual([]);
  });
});
