// CR-159 · int (Hono thật defs + company-flows + DB thật): `applyTenantFlows` dựng quy trình cho 3 công ty evolu / nitigroup / preschool
// đúng số lượng, đúng người ở từng bước; dry-run không ghi; chạy lần 2 không đổi gì (version giữ nguyên, kết quả «unchanged»).
// CR-165 · đi từng bước theo def ĐÃ LƯU (`walk`): HĐ gửi đi → duyệt → ký → «Nhờ đối tác ký?» Có / Không; chạy lại trên công ty có quy trình cũ.
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
import { NEVER_TRIGGER } from "./seed-purchase-flow.kit";
import { applyTenantFlows, type Call, type Json, must } from "./tenant-flows.core";
import {
  emailsOf,
  FLOW_NAMES,
  type FlowDef,
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
const opt = (dryRun: boolean) => ({ dryRun });
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
      P("sign_together", "boolean"),
      P("sign_reason"),
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

/** Mỗi người tạo của công ty: HĐ gửi đi đúng chuỗi (cấp cao nhất bỏ duyệt, người khác qua trưởng phòng). */
async function expectChains(k: TenantKey): Promise<void> {
  const org = readOrg(k);
  for (const u of org.users) {
    const head = u === org.rootHead ? [] : [headOfCreator(org, u) as string];
    expect(await chain(k, FLOW_NAMES.send, org, u)).toEqual(head);
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

type Step = { key: string; who: string };
const SYSTEM = "(hệ thống)";
/**
 * Đi MỘT lượt theo def đã lưu như engine (nhánh vui): `if` theo dữ kiện / ô form đã trả lời, bước Duyệt và Làm việc ghi người làm
 * (`approver_user_id` ⇒ email; `starter_head` ⇒ trưởng phòng của người tạo, tự leo cấp), bước hệ thống (Ký, Gửi, Chờ) ghi SYSTEM.
 * Dừng ở bước Kết thúc; trả danh sách bước đã qua + bước Kết thúc.
 */
/** Bước kế của `if` theo dữ kiện «người tạo là cấp cao nhất» hoặc ô form đã trả lời. */
function ifNext(ex: Json, st: St, top: boolean, answers: Record<string, string>): number {
  const c = (ex.when.conds as Json[])[0] as Json;
  const hit =
    c.from.kind === "fact"
      ? top && c.from.key === "starter_is_top"
      : answers[c.from.field] === c.value;
  return hit ? ex.then_step : (ex.else_step ?? st.step + 1);
}
async function walk(
  k: TenantKey,
  flow: string,
  creator: string,
  answers: Record<string, string> = {},
): Promise<{ steps: Step[]; end: St }> {
  const org = readOrg(k);
  const stages = (await defOf(k, flow)).stages as St[];
  const mail = new Map([...(ids.get(k) as Map<string, string>)].map(([e, id]) => [id, e]));
  const head = headOfCreator(org, creator) as string;
  const steps: Step[] = [];
  let st = stages.find((s) => s.step === 0) as St;
  for (let n = 0; n < 40; n++) {
    if (st.outcome !== undefined) return { steps, end: st };
    const ex = st.executor;
    const id = st.after?.approver_user_id as string | undefined;
    const human = ex.kind === "approve" || ex.kind === "form";
    steps.push({ key: st.key, who: human ? (mail.get(id as string) ?? head) : SYSTEM });
    const to =
      ex.kind === "if"
        ? ifNext(ex, st, creator === org.rootHead, answers)
        : (st.next_step ?? st.step + 1);
    st = stages.find((s) => s.step === to) as St;
  }
  throw new Error("vòng lặp");
}
const keysOf = (r: { steps: Step[] }) => r.steps.map((s) => s.key);
const whoAt = (r: { steps: Step[] }, key: string) => r.steps.find((s) => s.key === key)?.who;
const NO = { nho_doi_tac: "khong" };
const YES = { nho_doi_tac: "co" };

describe("CR-159 · quy trình 3 công ty", () => {
  it("dry-run: nói sẽ tạo, không ghi gì", async () => {
    const rep = await applyTenantFlows(ctx("evolu"), flowsFor("evolu", uidOf("evolu")), opt(true));
    expect(rep.map((r) => r.action)).toEqual(["created", "created"]);
    expect(await list("evolu")).toHaveLength(0);
  });

  it("lần 1: đủ số quy trình, đang Bật + đã áp dụng, không có phiếu «Đề nghị mua hàng / thanh toán» (CR-167)", async () => {
    const want = { evolu: 2, nitigroup: 2, preschool: 2 };
    for (const k of TENANT_KEYS) {
      const rep = await applyTenantFlows(ctx(k), flowsFor(k, uidOf(k)), opt(false));
      expect(rep.every((r) => r.action === "created")).toBe(true);
      const rows = await list(k);
      expect(rows).toHaveLength(want[k]);
      expect(rows.every((r) => r.enabled === true && r.rel_version !== null)).toBe(true);
    }
    for (const k of TENANT_KEYS)
      expect((await list(k)).map((r) => r.name).sort()).toEqual(
        [FLOW_NAMES.send, FLOW_NAMES.receive].sort(),
      );
  });

  it("evolu: Ký qua tải bản đã ký (Thomas), trigger Nhận HĐ có người phụ trách", async () => {
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
  });

  it("evolu: chuỗi người duyệt theo người tạo, Thomas tạo thì không duyệt", async () => {
    const org = readOrg("evolu");
    const th = WHO.evolu.thomas;
    for (const c of ["julian.bui", "rowan.hoang", "vio.ngo", "edgar.nguyen"].map(
      (n) => `${n}@evolu.com`,
    )) {
      expect(await chain("evolu", FLOW_NAMES.send, org, c)).toEqual([th]);
    }
    expect(await chain("evolu", FLOW_NAMES.send, org, th)).toEqual([]);
    expect(await chain("evolu", FLOW_NAMES.receive, org, WHO.evolu.julian)).toEqual([th]);
  });

  it("nitigroup: mọi người trừ Tiên đi qua Tiên, Tiên tạo thì bỏ duyệt", async () => {
    const org = readOrg("nitigroup");
    const { tien, vy, ngan } = WHO.nitigroup;
    for (const c of [
      vy,
      ngan,
      "hr@nitigroupvn.com",
      "admin@nitigroupvn.com",
      WHO.nitigroup.phuong,
    ]) {
      expect(await chain("nitigroup", FLOW_NAMES.send, org, c)).toEqual([tien]);
    }
    // CR-160 · Tiên (cấp cao nhất) tạo: bỏ duyệt (Ngân, cùng phòng gốc, vẫn → Tiên ở vòng trên)
    expect(await chain("nitigroup", FLOW_NAMES.send, org, tien)).toEqual([]);
    expect(await chain("nitigroup", FLOW_NAMES.receive, org, vy)).toEqual([tien]);
    const send = await defOf("nitigroup", FLOW_NAMES.send);
    const ky = (send.stages as St[]).find((s) => s.executor.tool_key === "contracts-esign-send");
    expect(ky?.executor.args.company_signers.value).toBe(`user:${uidOf("nitigroup")(tien)}`);
    expect(JSON.stringify(send.stages)).not.toContain('escalate":{"after_h');
  });

  it("preschool: không bước Duyệt nào, Dung ký, có Gửi đối tác, Nhận HĐ Dung ký", async () => {
    const org = readOrg("preschool");
    const dung = WHO.preschool.dung;
    expect(await chain("preschool", FLOW_NAMES.send, org, dung)).toEqual([]);
    expect(await chain("preschool", FLOW_NAMES.receive, org, dung)).toEqual([]);
    const send = await defOf("preschool", FLOW_NAMES.send);
    const ky = (send.stages as St[]).find((s) => s.executor.tool_key === "contracts-esign-send");
    expect(ky?.executor.args.company_signers.value).toBe(`user:${uidOf("preschool")(dung)}`);
    expect(send.stages.map((s: St) => s.name)).toContain("Gửi đối tác xác nhận");
  });

  it("CR-160 · mỗi người tạo của mỗi công ty ⇒ đúng chuỗi, cấp cao nhất bỏ duyệt, không còn nhánh theo phòng hay đích dự phòng", async () => {
    for (const k of TENANT_KEYS) {
      await expectChains(k);
      await expectNoOldBranch(k);
    }
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

  it("CR-165 (a) nitigroup: nhân viên tạo ⇒ Tiên duyệt ⇒ Tiên ký ⇒ chọn Không ⇒ Kết thúc «Đã duyệt» (nội bộ)", async () => {
    const { tien, vy } = WHO.nitigroup;
    const r = await walk("nitigroup", FLOW_NAMES.send, vy, NO);
    expect(keysOf(r)).toEqual([
      "re-nhanh",
      "truong-phong",
      "ky-so",
      "cho-ky",
      "nho-doi-tac",
      "re-doi-tac",
    ]);
    expect(whoAt(r, "truong-phong")).toBe(tien); // người duyệt khác người tạo
    expect(whoAt(r, "nho-doi-tac")).toBe(tien); // người ký quyết
    expect(r.end.key).toBe("ket-thuc-noi-bo");
    expect(r.end.outcome).toBe("approved");
    expect(r.end.name).toBe("Kết thúc · Đã duyệt");
  });

  it("CR-165 (b) nitigroup: Tiên tự tạo ⇒ không bước duyệt ⇒ ký ⇒ chọn Có ⇒ tới bước chọn đối tác, gửi kèm đề nghị ký cùng lúc", async () => {
    const { tien } = WHO.nitigroup;
    const r = await walk("nitigroup", FLOW_NAMES.send, tien, YES);
    expect(keysOf(r)).toEqual([
      "re-nhanh",
      "chuan-bi-ky",
      "ky-so",
      "cho-ky",
      "nho-doi-tac",
      "re-doi-tac",
      "chon-doi-tac",
      "gui-doi-tac",
      "cho-doi-tac",
    ]);
    expect(whoAt(r, "chon-doi-tac")).toBe(tien);
    expect(r.end.key).toBe("ket-thuc-approved");
    expect(r.end.name).toBe("Kết thúc · Đã xác nhận");
    const def = await defOf("nitigroup", FLOW_NAMES.send);
    const gui = (def.stages as St[]).find((s) => s.key === "gui-doi-tac") as St;
    expect(gui.executor.args.sign_together).toEqual({ from: "const", value: true });
    expect(gui.executor.args.sign_reason.value.length).toBeGreaterThan(0);
  });

  it("CR-165 (c) preschool: Dung tạo ⇒ chuẩn bị ký ⇒ ký ⇒ chọn Có ⇒ tới bước chọn đối tác; evolu: Julian tạo ⇒ Thomas duyệt ⇒ chọn Không", async () => {
    const { dung } = WHO.preschool;
    const r = await walk("preschool", FLOW_NAMES.send, dung, YES);
    expect(keysOf(r)).toEqual([
      "chuan-bi-ky",
      "ky-so",
      "cho-ky",
      "nho-doi-tac",
      "re-doi-tac",
      "chon-doi-tac",
      "gui-doi-tac",
      "cho-doi-tac",
    ]);
    expect(whoAt(r, "nho-doi-tac")).toBe(dung);
    expect(whoAt(r, "chon-doi-tac")).toBe(dung);
    const { thomas, julian } = WHO.evolu;
    const e = await walk("evolu", FLOW_NAMES.send, julian, NO);
    expect(whoAt(e, "truong-phong")).toBe(thomas);
    expect(whoAt(e, "nho-doi-tac")).toBe(thomas);
    expect(e.end.key).toBe("ket-thuc-noi-bo");
  });

  it("CR-165: Nhận hợp đồng từ đối tác không có bước «Nhờ đối tác ký?» và vẫn kết thúc Đồng ý", async () => {
    const r = await walk("nitigroup", FLOW_NAMES.receive, WHO.nitigroup.vy);
    expect(keysOf(r)).not.toContain("nho-doi-tac");
    expect(r.end.outcome).toBe("confirmed");
  });

  it("CR-165: chạy lại trên công ty có quy trình cũ ⇒ thay sơ đồ cùng tên (không trùng), tắt quy trình thừa (không xoá), lần sau không đổi", async () => {
    const k: TenantKey = "preschool";
    const dung = WHO.preschool.dung;
    const [send, recv] = flowsFor(k, uidOf(k)) as [FlowDef, FlowDef];
    const phieu: FlowDef = {
      ...send,
      name: "Đề nghị mua hàng / thanh toán",
      trigger: NEVER_TRIGGER,
    };
    const legacy = (send.stages as St[]).map((x) =>
      x.key === "ky-so" ? { ...x, name: "Ký số (bản cũ)" } : x,
    );
    const oldSend: FlowDef = { ...send, stages: legacy }; // sơ đồ cũ cùng tên
    await applyTenantFlows(ctx(k), [oldSend, recv, phieu], opt(false));
    expect(await list(k)).toHaveLength(3);
    const nameOfSign = async () =>
      ((await defOf(k, FLOW_NAMES.send)).stages as St[]).find((x) => x.key === "ky-so")?.name;
    expect(await nameOfSign()).toBe("Ký số (bản cũ)");

    const dry = await applyTenantFlows(ctx(k), flowsFor(k, uidOf(k)), opt(true));
    const got = dry.map((r) => `${r.name}:${r.action}`).sort();
    expect(got).toEqual(
      [
        `${FLOW_NAMES.send}:updated`,
        `${FLOW_NAMES.receive}:unchanged`,
        `${phieu.name}:disabled`,
      ].sort(),
    );
    expect((await list(k)).find((r) => r.name === phieu.name)?.enabled).toBe(true); // dry-run không ghi

    await applyTenantFlows(ctx(k), flowsFor(k, uidOf(k)), opt(false));
    const rows = await list(k);
    expect(rows).toHaveLength(3); // không tạo trùng, không xoá
    const on = rows.filter((r) => r.enabled === true).map((r) => r.name);
    expect(on.sort()).toEqual([FLOW_NAMES.send, FLOW_NAMES.receive].sort());
    expect(rows.find((r) => r.name === phieu.name)?.enabled).toBe(false);
    expect(await nameOfSign()).toBe("Ký hợp đồng"); // sơ đồ đã thay
    expect(keysOf(await walk(k, FLOW_NAMES.send, dung, YES))).toContain("nho-doi-tac");

    const snap = (xs: Json[]) =>
      xs.map((r) => [r.id, r.def_version, r.rel_version, r.position, r.enabled]);
    const again = await applyTenantFlows(ctx(k), flowsFor(k, uidOf(k)), opt(false));
    expect(again.every((r) => r.action === "unchanged")).toBe(true);
    expect(snap(await list(k))).toEqual(snap(rows));
  });
});
