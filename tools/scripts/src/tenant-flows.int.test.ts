// CR-159 · int (Hono thật defs + company-flows + DB thật): `applyTenantFlows` dựng quy trình cho 3 công ty evolu / nitigroup / preschool
// đúng số lượng, đúng người ở từng bước; dry-run không ghi; chạy lần 2 không đổi gì (version giữ nguyên, kết quả «unchanged»).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../apps/hub-api/src/lib/auth.middleware";
import { connectDb, type Db } from "../../../apps/hub-api/src/lib/db";
import { mapError } from "../../../apps/hub-api/src/lib/errors";
import type { ProcessDeps } from "../../../apps/hub-api/src/modules/processes/core/ports";
import { defsRoutes } from "../../../apps/hub-api/src/modules/processes/defs/defs.routes";
import { companyFlowsRoutes } from "../../../apps/hub-api/src/modules/processes/library/company-flows.routes";
import { applyTenantFlows, type Call, type Json, must } from "./tenant-flows.core";
import {
  emailsOf,
  FLOW_NAMES,
  flowsFor,
  PICK_GROUP,
  TENANT_KEYS,
  type TenantKey,
  WHO,
} from "./tenant-flows.data";
import { headOfCreator, type Org, readOrg } from "./tenant-flows.org";

const T: Record<TenantKey, string> = {
  evolu: tenantId(1591),
  nitigroup: tenantId(1592),
  preschool: tenantId(1593),
};
const FROM: Record<TenantKey, number> = { evolu: 15910, nitigroup: 15920, preschool: 15930 };
const ADMIN = { userId: userId(15900), tenantId: T.evolu, role: "platform_admin" as Role };
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;

const hub: Call = async (method, path, body) => {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
};
const ids = new Map<TenantKey, Map<string, string>>();
const uidOf = (k: TenantKey) => (e: string) => ids.get(k)?.get(e) as string;
const grp = new Map<TenantKey, Map<string, string>>();
const ctx = (k: TenantKey) => ({ hub, tid: T[k], groups: grp.get(k) as Map<string, string> });
const opt = (dryRun: boolean) => ({
  dryRun,
  buyName: FLOW_NAMES.buy,
  sendName: FLOW_NAMES.send,
});
const list = async (k: TenantKey): Promise<Json[]> =>
  must(await hub("GET", `/tenants/${T[k]}/company-flows`), [200], "list").items as Json[];
const defOf = async (k: TenantKey, name: string): Promise<Json> => {
  const row = (await list(k)).find((r) => r.name === name) as Json;
  return must(await hub("GET", `/process-defs/${row.flow_id}?tenant_id=${T[k]}`), [200], "def");
};
type St = Json;
beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${T.evolu}, 't1591', 'Evolu'), (${T.nitigroup}, 't1592', 'Niti'), (${T.preschool}, 't1593', 'Pre')`;
  await users(o, T.evolu, 1, { from: 15900, role: "member" }); // admin nền tảng
  for (const k of TENANT_KEYS) {
    const mails = emailsOf(k);
    await users(o, T[k], mails.length, { from: FROM[k] });
    grp.set(k, await groups(o, T[k], [PICK_GROUP[k]]));
    ids.set(k, new Map(mails.map((m, i) => [m, userId(FROM[k] + i)])));
  }
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", ADMIN as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return c.json(m.body, m.status);
  });
  // danh mục tool của gói (app thật nối ở app.ts): giả lập «mọi tool đều dùng được» để kiểm bước/luật của def, không dựng cả module ký số
  const P = (name: string, type = "string", required = false) => ({ name, type, required });
  const PARAMS: Record<string, ReturnType<typeof P>[]> = {
    "contracts-esign-send": [P("contract_id", "string", true), P("provider"), P("company_signers")],
    "contracts-partner-send": [
      P("contract_id", "string", true),
      P("send_fields"),
      P("reply_days", "number"),
      P("assignee_group"),
    ],
  };
  const packTools = {
    available: async (_t: string, keys: readonly string[]) =>
      keys.map((key) => ({
        key,
        name: key,
        description: "",
        sideEffect: true,
        params: PARAMS[key] ?? [],
      })),
  };
  const deps = { db, packTools } as unknown as ProcessDeps;
  app.route("/", defsRoutes(deps));
  app.route("/", companyFlowsRoutes(deps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const FALLBACK = "(đích dự phòng)";
/** Đi theo def ĐÃ LƯU qua API: nhánh `if starter_is_top` (Đúng ⇔ người tạo là trưởng gốc, như engine), `starter_head` theo luật engine; trả danh sách người duyệt tới bước Ký / Ghi đã chi. */
async function chain(k: TenantKey, flow: string, org: Org, creator: string): Promise<string[]> {
  const def = await defOf(k, flow);
  const byEmail = new Map([...(ids.get(k) as Map<string, string>)].map(([e, id]) => [id, e]));
  const stages = def.stages as St[];
  const isTop = creator === org.rootHead;
  const out: string[] = [];
  let st = stages.find((s) => s.step === 0);
  for (let n = 0; st && n < 40 && !isStop(st); n++) {
    if (st.executor.kind === "approve") {
      const id = st.after.approver_user_id;
      out.push((id ? byEmail.get(id) : headOfCreator(org, creator)) ?? FALLBACK);
    }
    const to = nextStep(st, isTop);
    st = stages.find((s) => s.step === to);
  }
  return out;
}
const isStop = (st: St) =>
  st.executor.tool_key === "contracts-esign-send" || st.key === "ghi-da-chi";
/** Bước kế: `if starter_is_top` theo người tạo (chỉ nhận vế đó), còn lại `next_step` hoặc bước liền sau. */
function nextStep(st: St, isTop: boolean): number {
  const ex = st.executor;
  if (ex.kind !== "if") return st.next_step ?? st.step + 1;
  const cond = (ex.when.conds as Json[])[0];
  expect(ex.when.conds).toHaveLength(1);
  expect(cond?.from).toEqual({ kind: "fact", key: "starter_is_top" });
  return isTop ? ex.then_step : ex.else_step;
}

/** Mỗi người tạo của công ty: HĐ gửi đi + phiếu đúng chuỗi (cấp cao nhất bỏ duyệt, người khác qua trưởng phòng; nitigroup phiếu thêm Phương kiểm). */
async function expectChains(k: TenantKey): Promise<void> {
  const org = readOrg(k);
  const hasBuy = (await list(k)).some((r) => r.name === FLOW_NAMES.buy);
  const check = k === "nitigroup" ? [WHO.nitigroup.phuong] : [];
  for (const u of org.users) {
    const head = u === org.rootHead ? [] : [headOfCreator(org, u) as string];
    expect(await chain(k, FLOW_NAMES.send, org, u)).toEqual(head);
    if (hasBuy) expect(await chain(k, FLOW_NAMES.buy, org, u)).toEqual([...head, ...check]);
  }
}
/** Không còn nhánh theo phòng (`creator_department`) hay đích dự phòng ở bước nào. */
async function expectNoOldBranch(k: TenantKey): Promise<void> {
  for (const r of await list(k)) {
    const text = JSON.stringify((await defOf(k, r.name as string)).stages);
    expect(text).not.toContain("creator_department");
    expect(text).not.toContain(FALLBACK);
  }
}

describe("CR-159 · quy trình 3 công ty", () => {
  it("dry-run: nói sẽ tạo, không ghi gì", async () => {
    const rep = await applyTenantFlows(ctx("evolu"), flowsFor("evolu", uidOf("evolu")), opt(true));
    expect(rep.map((r) => r.action)).toEqual(["created", "created", "created"]);
    expect(await list("evolu")).toHaveLength(0);
  });

  it("lần 1: đủ số quy trình, đang Bật + đã áp dụng, phiếu đứng trước HĐ gửi đi", async () => {
    const want = { evolu: 3, nitigroup: 3, preschool: 2 };
    for (const k of TENANT_KEYS) {
      const rep = await applyTenantFlows(ctx(k), flowsFor(k, uidOf(k)), opt(false));
      expect(rep.every((r) => r.action === "created")).toBe(true);
      const rows = await list(k);
      expect(rows).toHaveLength(want[k]);
      expect(rows.every((r) => r.enabled === true && r.rel_version !== null)).toBe(true);
    }
    for (const k of ["evolu", "nitigroup"] as const) {
      const rows = await list(k);
      const pos = (n: string) => rows.find((r) => r.name === n)?.position as number;
      expect(pos(FLOW_NAMES.buy)).toBeLessThan(pos(FLOW_NAMES.send));
    }
  });

  it("evolu: Ký qua tải bản đã ký (Thomas), trigger Nhận HĐ có người phụ trách, phiếu đủ ô", async () => {
    const [thomas, julian] = [WHO.evolu.thomas, WHO.evolu.julian].map(uidOf("evolu")) as [
      string,
      string,
    ];
    const send = await defOf("evolu", FLOW_NAMES.send);
    const ky = (send.stages as St[]).find((s) => s.executor.tool_key === "contracts-esign-send");
    expect(ky?.executor.args.provider.value).toBe("upload");
    expect(ky?.executor.args.company_signers.value).toBe(`user:${thomas}`);
    const names = send.stages.map((s: St) => s.name);
    expect(names).toContain("Gửi đối tác xác nhận");
    expect(names).toContain("Chọn đối tác & người nhận");
    const recv = await defOf("evolu", FLOW_NAMES.receive);
    expect(recv.trigger.event).toBe("contract.received");
    expect(recv.trigger.params.owner_user_id).toBe(julian);
    const buy = await defOf("evolu", FLOW_NAMES.buy);
    expect((buy.stages as St[]).find((s) => s.key === "ghi-da-chi")?.after.approver_user_id).toBe(
      thomas,
    );
    expect((buy.stages as St[])[0]?.start_form.fields.map((f: Json) => f.key)).toEqual([
      "noi_dung",
      "so_tien",
      "nha_cung_cap",
      "tep_dinh_kem",
    ]);
  });

  it("evolu: chuỗi người duyệt theo người tạo, Thomas tạo thì không duyệt", async () => {
    const org = readOrg("evolu");
    const th = WHO.evolu.thomas;
    for (const c of ["julian.bui", "rowan.hoang", "vio.ngo", "edgar.nguyen"].map(
      (n) => `${n}@evolu.com`,
    )) {
      expect(await chain("evolu", FLOW_NAMES.send, org, c)).toEqual([th]);
      expect(await chain("evolu", FLOW_NAMES.buy, org, c)).toEqual([th]);
    }
    expect(await chain("evolu", FLOW_NAMES.send, org, th)).toEqual([]);
    // CR-160 · phiếu cũng rẽ theo `starter_is_top`: Thomas tạo phiếu ⇒ bỏ duyệt (không còn đích dự phòng)
    expect(await chain("evolu", FLOW_NAMES.buy, org, th)).toEqual([]);
    expect(await chain("evolu", FLOW_NAMES.receive, org, WHO.evolu.julian)).toEqual([th]);
  });

  it("nitigroup: mọi người trừ Tiên đi qua Tiên, phiếu thêm Phương kiểm, Tiên tạo thì bỏ duyệt", async () => {
    const org = readOrg("nitigroup");
    const { tien, phuong, vy, ngan } = WHO.nitigroup;
    for (const c of [vy, ngan, "hr@nitigroupvn.com", "admin@nitigroupvn.com", phuong]) {
      expect(await chain("nitigroup", FLOW_NAMES.send, org, c)).toEqual([tien]);
      expect(await chain("nitigroup", FLOW_NAMES.buy, org, c)).toEqual([tien, phuong]);
    }
    // CR-160 · Tiên (cấp cao nhất) tạo: bỏ duyệt (Ngân, cùng phòng gốc, vẫn → Tiên ở vòng trên); phiếu vẫn Phương kiểm
    expect(await chain("nitigroup", FLOW_NAMES.send, org, tien)).toEqual([]);
    expect(await chain("nitigroup", FLOW_NAMES.buy, org, tien)).toEqual([phuong]);
    expect(await chain("nitigroup", FLOW_NAMES.receive, org, vy)).toEqual([tien]);
    const send = await defOf("nitigroup", FLOW_NAMES.send);
    const ky = (send.stages as St[]).find((s) => s.executor.tool_key === "contracts-esign-send");
    expect(ky?.executor.args.company_signers.value).toBe(`user:${uidOf("nitigroup")(tien)}`);
    expect(JSON.stringify(send.stages)).not.toContain('escalate":{"after_h');
  });

  it("preschool: không bước Duyệt nào, Dung ký, có Gửi đối tác, Nhận HĐ Dung ký, không phiếu", async () => {
    const org = readOrg("preschool");
    const dung = WHO.preschool.dung;
    expect(await chain("preschool", FLOW_NAMES.send, org, dung)).toEqual([]);
    expect(await chain("preschool", FLOW_NAMES.receive, org, dung)).toEqual([]);
    const send = await defOf("preschool", FLOW_NAMES.send);
    const ky = (send.stages as St[]).find((s) => s.executor.tool_key === "contracts-esign-send");
    expect(ky?.executor.args.company_signers.value).toBe(`user:${uidOf("preschool")(dung)}`);
    expect(send.stages.map((s: St) => s.name)).toContain("Gửi đối tác xác nhận");
    expect((await list("preschool")).map((r) => r.name)).not.toContain(FLOW_NAMES.buy);
  });

  it("CR-160 · mỗi người tạo của mỗi công ty ⇒ đúng chuỗi, cấp cao nhất bỏ duyệt, không còn nhánh theo phòng hay đích dự phòng", async () => {
    for (const k of TENANT_KEYS) {
      await expectChains(k);
      await expectNoOldBranch(k);
    }
    // phiếu có nhánh `starter_is_top` (Đúng ⇒ bỏ duyệt) ở evolu + nitigroup; không phiếu ở preschool
    for (const k of ["evolu", "nitigroup"] as const)
      expect(JSON.stringify((await defOf(k, FLOW_NAMES.buy)).stages)).toContain("starter_is_top");
  });

  it("không có ngưỡng tiền ở bước nào", async () => {
    for (const k of TENANT_KEYS)
      for (const r of await list(k)) {
        const d = await defOf(k, r.name);
        const ifs = (d.stages as St[]).filter((s) => s.executor.kind === "if");
        expect(JSON.stringify(ifs)).not.toContain("total_value");
      }
  });

  it("chạy lần 2: không đổi gì (unchanged, version giữ nguyên, không thêm dòng)", async () => {
    for (const k of TENANT_KEYS) {
      const before = await list(k);
      const rep = await applyTenantFlows(ctx(k), flowsFor(k, uidOf(k)), opt(false));
      expect(rep.every((r) => r.action === "unchanged")).toBe(true);
      const after = await list(k);
      expect(after.map((r) => [r.id, r.def_version, r.rel_version, r.position])).toEqual(
        before.map((r) => [r.id, r.def_version, r.rel_version, r.position]),
      );
    }
  });
});
