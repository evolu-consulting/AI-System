// CR-118 · UW-FR-10/11/13/14 · ADR-0035 · flow runtime của kit trên hub THẬT (khuôn CF: gói contracts + duyệt trên engine) với cờ
// `HUB_FLOW_RUNTIME=on`: GET FlowView == chiếu của thẻ duyệt hôm nay (cùng người xem), hành động qua flow = hành động thẻ (bước kế
// mở), task cũ ⇒ 409; summary lô 100 chỉ trả HĐ thấy được (tenant khác vắng); tenant khác + đối tác (user ngoài) bị chặn.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { FlowSummarySchema, FlowViewSchema } from "@ai/contracts/flow";
import { flowViewOfCard } from "../../../apps/hub-api/src/modules/packs/contracts/domain/approval-flow-view.rules";
import { type CtxCf, startCf } from "../CF/_cf";
import { sign } from "../H1/_fixtures";
import { cid, insContract } from "../HD1/_support/hd1";
import { C1_TEXT } from "../HD2/_support/hd2";
import { seedContract, toLevel1 } from "../HD3/_hd3";
import { type Json, PA, T, waitFor } from "../P-d/_support/pd";

const SLOT = "contracts.approval";
const FLOW = `/pack/contracts/flow/${SLOT}`;
const CBASE = "/pack/contracts/contracts";
const BIG = 600_000_000;
const ORG = "01900000-0000-7000-8000-0000000c1181";
const EXT_ID = "01900000-0000-7000-8000-0000000c1182";

let c: CtxCf;
let prevFlag: string | undefined;
beforeAll(async () => {
  prevFlag = process.env.HUB_FLOW_RUNTIME;
  process.env.HUB_FLOW_RUNTIME = "on";
  c = await startCf();
}, 180_000);
afterAll(async () => {
  await c?.stop();
  if (prevFlag === undefined) delete process.env.HUB_FLOW_RUNTIME;
  else process.env.HUB_FLOW_RUNTIME = prevFlag;
});

const card = async (r: "A" | "B" | "H", id: string) =>
  (await c.call(r, "GET", `${CBASE}/${id}/approval`)).json as Json;
const flow = (r: "A" | "B" | "H" | "Db", id: string) => c.call(r, "GET", `${FLOW}/${id}`);
const version = async (id: string) =>
  (
    await c.sql<{ v: number | null }[]>`select a.flow_version as v from contracts.approvals a
      join contracts.contracts k on k.run_id = a.id where k.id = ${id}`
  )[0]?.v ?? null;

async function openAt(id: string, idx: number) {
  const j = await waitFor(
    () => card("A", id),
    (x) => x?.steps?.[idx]?.status === "open",
    10_000,
  );
  expect(j?.steps?.[idx]?.status).toBe("open");
}

describe("CR-118 · flow runtime contracts.approval (cờ bật)", () => {
  let id = "";
  it("GET FlowView == chiếu thẻ duyệt hôm nay (A, B, H) + đúng schema + snapshot_version", async () => {
    id = await seedContract(c, 1181);
    await toLevel1(c, id, BIG);
    await openAt(id, 0);
    const ver = await version(id);
    for (const r of ["A", "B", "H"] as const) {
      const [k, f] = [await card(r, id), await flow(r, id)];
      expect(f.status).toBe(200);
      const v = FlowViewSchema.parse(f.json);
      expect(v).toEqual(flowViewOfCard(k as never, id, ver));
      expect(v.run?.snapshot_version).toBe(ver);
    }
    const asB = FlowViewSchema.parse((await flow("B", id)).json);
    expect(asB.tasks[0]?.actions.map((a) => a.key)).toEqual(["approve", "redo", "reject"]);
  }, 60_000);

  it("act qua flow: task cũ ⇒ 409; Duyệt (B) ⇒ bước 1 mở, như POST thẻ", async () => {
    const v = FlowViewSchema.parse((await flow("B", id)).json);
    const task = v.tasks[0]?.task_id as string;
    const stale = await c.call(
      "B",
      "POST",
      `${FLOW}/${id}/tasks/${crypto.randomUUID()}/actions/approve`,
      {},
    );
    expect({ s: stale.status, code: stale.json?.error?.code }).toEqual({
      s: 409,
      code: "APPROVAL_NOT_OPEN",
    });
    const noFb = await c.call("B", "POST", `${FLOW}/${id}/tasks/${task}/actions/reject`, {});
    expect({ s: noFb.status, code: noFb.json?.error?.code }).toEqual({
      s: 422,
      code: "FEEDBACK_REQUIRED",
    });
    const r = await c.call("B", "POST", `${FLOW}/${id}/tasks/${task}/actions/approve`, {});
    expect(r.status).toBe(200);
    expect(r.json?.view?.steps?.[0]?.status).toBe("passed");
    await openAt(id, 1);
  }, 60_000);

  it("summary lô 100: chỉ HĐ thấy được; HĐ tenant khác + ref không tồn tại vắng; schema đúng", async () => {
    const other = cid(1189);
    await insContract(c.sql, {
      id: other,
      tenant: T.beta,
      status: "extract_failed",
      source: C1_TEXT,
      createdBy: PA.Db.id,
    } as never);
    const refs = [id, other, ...Array.from({ length: 98 }, () => crypto.randomUUID())];
    const r = await c.call("A", "POST", `${FLOW}/summary`, { refs });
    expect(r.status).toBe(200);
    const s = FlowSummarySchema.parse(r.json);
    expect(s.items.map((x) => x.ref)).toEqual([id]);
    expect(s.items[0]).toMatchObject({ state: "running", phase: "level1" });
    const big = await c.call("A", "POST", `${FLOW}/summary`, {
      refs: [...refs, crypto.randomUUID()],
    });
    expect(big.status).toBe(400);
  }, 60_000);

  it("tenant khác (Db, beta) không đọc/không quyết được HĐ acme", async () => {
    const v = await flow("Db", id);
    expect([403, 404]).toContain(v.status);
    expect(v.json?.steps).toBeUndefined();
    const task =
      FlowViewSchema.parse((await flow("H", id)).json).tasks[0]?.task_id ?? crypto.randomUUID();
    const a = await c.call("Db", "POST", `${FLOW}/${id}/tasks/${task}/actions/approve`, {});
    expect([403, 404]).toContain(a.status);
    const s = await c.call("Db", "POST", `${FLOW}/summary`, { refs: [id] });
    expect([403, 404]).toContain(s.status);
  }, 60_000);

  it("đối tác (user ngoài acme) ⇒ 403 view/act/summary", async () => {
    await c.sql`insert into admin.external_orgs (id, tenant_id, name) values (${ORG}, ${T.acme}, 'NCC CR118')
      on conflict do nothing`;
    await c.sql`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind,
        external_org_id, must_change_password) values
      (${EXT_ID}, ${T.acme}, 'ncc-cr118', 'x', 'Đối tác CR118', 'member', 'external', ${ORG}, false)
      on conflict do nothing`;
    const claims = { tid: T.acme, role: "member", sid: null, kind: "external", xorg: ORG };
    const tok = await sign(c.k, { ...PA.A, id: EXT_ID } as never, { claims });
    const call = (method: string, path: string, body?: unknown) =>
      fetch(`${c.hub.base}${path}`, {
        method,
        headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const task = crypto.randomUUID();
    const rs = await Promise.all([
      call("GET", `${FLOW}/${id}`),
      call("POST", `${FLOW}/${id}/tasks/${task}/actions/approve`, {}),
      call("POST", `${FLOW}/summary`, { refs: [id] }),
    ]);
    expect(rs.map((x) => x.status)).toEqual([403, 403, 403]);
  }, 60_000);
});
