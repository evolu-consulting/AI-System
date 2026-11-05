// CR-120 · FLOW-FR-06 · ADR-0036 §5 · flow runtime MẶC ĐỊNH BẬT trên hub THẬT (khuôn CF, duyệt trên engine): không đặt env ⇒ route
// `/pack/contracts/flow/*` có + cờ `/pack/me.flags["flow.runtime"]`; hành động qua FlowRuntime.act = use case thẻ cũ; bấm lại / đua
// cùng task KHÔNG quyết bước kế (idempotent, kiểm trong use case); quyền như đường cũ; đối tác / tenant khác bị chặn, không đổi
// trạng thái. Rollback `HUB_FLOW_RUNTIME=off` ⇒ `/flow/*` 404, cờ tắt, endpoint approvals cũ vẫn quyết được.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { FlowViewSchema } from "@ai/contracts";
import { type CtxCf, startCf } from "../CF/_cf";
import { sign } from "../H1/_fixtures";
import { seedContract, toLevel1 } from "../HD3/_hd3";
import { type Json, PA, T, waitFor } from "../P-d/_support/pd";

const SLOT = "contracts.approval";
const FLOW = `/pack/contracts/flow/${SLOT}`;
const CBASE = "/pack/contracts/contracts";
const BIG = 600_000_000;
const ORG = "01900000-0000-7000-8000-0000000c1201";
const EXT_ID = "01900000-0000-7000-8000-0000000c1202";

type R = "A" | "B" | "H" | "X" | "Db";
let c: CtxCf;
let prevFlag: string | undefined;
beforeAll(() => {
  prevFlag = process.env.HUB_FLOW_RUNTIME;
});
afterAll(() => {
  if (prevFlag === undefined) delete process.env.HUB_FLOW_RUNTIME;
  else process.env.HUB_FLOW_RUNTIME = prevFlag;
});

const card = async (r: R, id: string) =>
  (await c.call(r, "GET", `${CBASE}/${id}/approval`)).json as Json;
const statuses = async (id: string) =>
  ((await card("A", id))?.steps ?? []).map((s: Json) => s.status as string);
const actFlow = (r: R, id: string, task: string, action: string, body: unknown = {}) =>
  c.call(r, "POST", `${FLOW}/${id}/tasks/${task}/actions/${action}`, body);
const code = (x: { json: Json }) => x.json?.error?.code ?? null;

async function openAt(id: string, idx: number) {
  const j = await waitFor(
    () => card("A", id),
    (x) => x?.steps?.[idx]?.status === "open",
    10_000,
  );
  expect(j?.steps?.[idx]?.status).toBe("open");
}
async function taskOf(r: R, id: string): Promise<string> {
  const v = FlowViewSchema.parse((await c.call(r, "GET", `${FLOW}/${id}`)).json);
  return v.tasks[0]?.task_id as string;
}
async function fresh(n: number): Promise<string> {
  const id = await seedContract(c, n);
  await toLevel1(c, id, BIG);
  await openAt(id, 0);
  return id;
}

describe("CR-120 · flow runtime mặc định bật (không đặt HUB_FLOW_RUNTIME)", () => {
  beforeAll(async () => {
    delete process.env.HUB_FLOW_RUNTIME;
    c = await startCf();
  }, 180_000);
  afterAll(async () => {
    await c?.stop();
  });

  it("route /flow/* có mặt + /pack/me.flags flow.runtime = true", async () => {
    const id = await fresh(1201);
    expect((await c.call("B", "GET", `${FLOW}/${id}`)).status).toBe(200);
    const me = await c.call("B", "GET", "/pack/me");
    expect(me.json?.flags?.["flow.runtime"]).toBe(true);
  }, 60_000);

  it("act qua flow = use case cũ; bấm lại cùng task ⇒ 409, bước kế KHÔNG bị quyết", async () => {
    const id = await fresh(1202);
    const task = await taskOf("B", id);
    const r = await actFlow("B", id, task, "approve");
    expect(r.status).toBe(200);
    expect(FlowViewSchema.parse(r.json.view).steps[0]?.status).toBe("passed");
    await openAt(id, 1);
    const before = await statuses(id);
    const again = await actFlow("B", id, task, "approve");
    expect({ s: again.status, code: code(again) }).toEqual({ s: 409, code: "APPROVAL_NOT_OPEN" });
    expect(await statuses(id)).toEqual(before);
  }, 60_000);

  it("đua: 2 lần Duyệt song song cùng task ⇒ đúng 1 thành công, bước 1 vẫn mở", async () => {
    const id = await fresh(1203);
    const task = await taskOf("B", id);
    const rs = await Promise.all([
      actFlow("B", id, task, "approve"),
      actFlow("B", id, task, "approve"),
    ]);
    expect(rs.map((x) => x.status).sort()).toEqual([200, 409]);
    await openAt(id, 1);
    const st = await statuses(id);
    expect([st[0], st[1]]).toEqual(["passed", "open"]);
  }, 60_000);

  it("quyền như đường cũ: X (không vai) ⇒ 403 cả flow lẫn approvals; lý do thiếu ⇒ 422 như cũ", async () => {
    const id = await fresh(1204);
    const task = await taskOf("B", id);
    const before = await statuses(id);
    const [flow, legacy] = [
      await actFlow("X", id, task, "approve"),
      await c.call("X", "POST", `${CBASE}/${id}/approval`, { action: "approve" }),
    ];
    expect([flow.status, legacy.status]).toEqual([403, 403]);
    const [fFb, lFb] = [
      await actFlow("B", id, task, "reject"),
      await c.call("B", "POST", `${CBASE}/${id}/approval`, { action: "reject" }),
    ];
    expect([fFb.status, code(fFb)]).toEqual([lFb.status, code(lFb)]);
    expect(await statuses(id)).toEqual(before);
  }, 60_000);

  it("tenant khác (Db) ⇒ 403/404; đối tác ⇒ 403; trạng thái không đổi", async () => {
    const id = await fresh(1205);
    const task = await taskOf("B", id);
    const before = await statuses(id);
    const cross = await actFlow("Db", id, task, "approve");
    expect([403, 404]).toContain(cross.status);
    expect(cross.json?.view).toBeUndefined();
    await c.sql`insert into admin.external_orgs (id, tenant_id, name) values (${ORG}, ${T.acme}, 'NCC CR120')
      on conflict do nothing`;
    await c.sql`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind,
        external_org_id, must_change_password) values
      (${EXT_ID}, ${T.acme}, 'ncc-cr120', 'x', 'Đối tác CR120', 'member', 'external', ${ORG}, false)
      on conflict do nothing`;
    const claims = { tid: T.acme, role: "member", sid: null, kind: "external", xorg: ORG };
    const tok = await sign(c.k, { ...PA.A, id: EXT_ID } as never, { claims });
    const ext = await fetch(`${c.hub.base}${FLOW}/${id}/tasks/${task}/actions/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(ext.status).toBe(403);
    expect(await statuses(id)).toEqual(before);
  }, 60_000);
});

describe("CR-120 · rollback HUB_FLOW_RUNTIME=off", () => {
  beforeAll(async () => {
    process.env.HUB_FLOW_RUNTIME = "off";
    c = await startCf();
  }, 180_000);
  afterAll(async () => {
    await c?.stop();
  });

  it("/flow/* 404, cờ tắt; endpoint approvals cũ vẫn quyết (bước 0 đạt ⇒ bước 1 mở)", async () => {
    const id = await fresh(1206);
    expect((await c.call("B", "GET", `${FLOW}/${id}`)).status).toBe(404);
    const me = await c.call("B", "GET", "/pack/me");
    expect(me.json?.flags?.["flow.runtime"]).toBe(false);
    const r = await c.call("B", "POST", `${CBASE}/${id}/approval`, { action: "approve" });
    expect(r.status).toBe(200);
    await openAt(id, 1);
    expect((await statuses(id))[0]).toBe("passed");
  }, 60_000);
});
