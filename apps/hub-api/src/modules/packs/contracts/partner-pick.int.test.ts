// CR-126 · «Chọn đối tác & người nhận» · DB thật: (b) tool gửi dùng người nhận ĐÃ CHỌN, không phải mặc định của HĐ; (c) chọn đối tác của công
// ty khác ⇒ lỗi nghiệp vụ PARTNER_NOT_IN_COMPANY, không ghi lần gửi nào; email sai dạng ⇒ PARTNER_EMAIL_INVALID; điền sẵn = đối tác + email
// của HĐ, danh sách = đối tác của CHÍNH công ty.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import {
  contracts,
  department,
  enablePack,
  members,
  tenants,
  users,
  visibility,
} from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db as HubDb } from "../../../lib/db";
import {
  registerFactsReader,
  registerOutcomeHandler,
  unregisterFlowPorts,
} from "../../processes/adapters/runs/flow-ports";
import type { ProcessDeps } from "../../processes/core/ports";
import { createStageLauncher } from "../../processes/runs/launcher";
import { packRunsOf } from "../../processes/runs/pack-runs";
import { dispatchOnce } from "../../processes/triggers/dispatcher";
import { setFlowTriggers } from "../../processes/triggers/flags";
import { flowLaunchOf } from "../../processes/triggers/flow-launch";
import { createPackUow } from "../kit/adapters/pack-uow";
import { formPrefillRegistry, type PackToolCtx } from "../kit/public";
import { esignRepo } from "./adapters/esign.repo";
import { partnerPrefill } from "./adapters/partner-prefill";
import { partnerSendRepo } from "./adapters/partner-send.repo";
import { partnerSendTool } from "./adapters/partner-send.tool";
import { PARTNER_SEND_KEY } from "./nodes/partner-send/binding";
import {
  actApproval,
  approvalEngineRepo,
  approvalRepo,
  contractFlowRepo,
  contractsFactsReader,
  contractsOutcomeHandler,
  engineCard,
  flowViewOfCard,
  getApproval,
  startApproval,
} from "./testing";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA = "";
let UB = "";
let CA: string[] = [];
const TAX_A1 = "0105555551"; // đối tác của A (HĐ 0)
const TAX_A2 = "0105555552"; // đối tác khác của A (HĐ 1) — người dùng chọn thay
const TAX_B = "0106666661"; // chỉ là đối tác của B

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    partnerSend: partnerSendRepo(tx, t),
    esign: esignRepo(tx, t),
  }));
const ctx = (): PackToolCtx => ({ tenantId: A, userId: UA, runId: null, processRunId: null });
const send = (id: string, extra: Record<string, unknown>) =>
  partnerSendTool({ uow: uow() }).run(ctx(), { contract_id: id, ...extra });
const sendsOf = async (id: string) =>
  Number(
    (await o`select count(*)::int as n from contracts.partner_sends where contract_id = ${id}`)[0]
      ?.n,
  );
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
};

async function contractWith(t: string, u: string, from: number, tax: string, email: string) {
  const [id] = (await contracts(o, t, 1, { from, createdBy: u, status: "active" })) as [string];
  const fid = crypto.randomUUID();
  await o`insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
    values (${fid}, ${t}, ${`t_${t}`}, ${`f${from}`}, ${`v${from}`}, 'hd.pdf', 'application/pdf', 16, ${u})`;
  await o`update contracts.contracts set file_id = ${fid}, direction = 'sale', fields = ${o.json({
    buyer_tax_id: { value: tax },
    buyer_name: { value: `Đối tác ${tax}` },
    total_value: { value: 1_000_000 },
  } as never)} where id = ${id}`;
  await o`insert into contracts.partner_contacts (tenant_id, party_key, name, email, created_by)
    values (${t}, ${`tax:${tax}`}, 'Liên hệ', ${email}, ${u})`;
  return id;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B] = (await tenants(o, 2, 1360)) as [string, string];
  [UA] = (await users(o, A, 1, { from: 1360 })) as [string];
  [UB] = (await users(o, B, 1, { from: 1361 })) as [string];
  CA = [
    await contractWith(A, UA, 1360, TAX_A1, "mac-dinh@doitac1.vn"),
    await contractWith(A, UA, 1361, TAX_A2, "khac@doitac2.vn"),
  ];
  await contractWith(B, UB, 1362, TAX_B, "b@doitacb.vn");
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-126 · chọn đối tác & người nhận", () => {
  it("sổ đối tác: mỗi công ty chỉ có đối tác của mình", async () => {
    const roles = await o`select tenant_id::text as t, party_key as k from contracts.partner_roles
      where party_key = any(${[`tax:${TAX_A1}`, `tax:${TAX_A2}`, `tax:${TAX_B}`]})`;
    expect(
      roles
        .filter((r) => r.t === A)
        .map((r) => r.k)
        .sort(),
    ).toEqual([`tax:${TAX_A1}`, `tax:${TAX_A2}`]);
    expect(roles.filter((r) => r.t === B).map((r) => r.k)).toEqual([`tax:${TAX_B}`]);
  });

  it("điền sẵn: MST + email của HĐ; lựa chọn = đối tác của chính công ty (không lộ đối tác công ty khác)", async () => {
    const p = await partnerPrefill(uow())({ tenantId: A, userId: UA, recordId: CA[0] as string });
    expect(p.field_defaults).toEqual({
      partner_tax_code: TAX_A1,
      partner_email: "mac-dinh@doitac1.vn",
    });
    const vals = (p.field_options.partner_tax_code ?? []).map((x) => x.value);
    expect(vals).toEqual(expect.arrayContaining([TAX_A1, TAX_A2]));
    expect(vals).not.toContain(TAX_B);
  });

  it("(b) gửi dùng người nhận ĐÃ CHỌN, không phải mặc định của HĐ", async () => {
    const id = CA[0] as string;
    const r = await send(id, { partner_tax_code: TAX_A2, partner_email: "nguoi-chon@doitac2.vn" });
    expect(r).toMatchObject({ status: "sent", channel: "email" });
    const [m] =
      await o`select to_email from hub.partner_mailbox where id = ${r.mailbox_id as string}::uuid`;
    expect(m?.to_email).toBe("nguoi-chon@doitac2.vn");
  });

  it("(c) chọn đối tác của công ty khác ⇒ PARTNER_NOT_IN_COMPANY, không ghi lần gửi; email sai ⇒ PARTNER_EMAIL_INVALID", async () => {
    const id = CA[1] as string;
    expect(await codeOf(send(id, { partner_tax_code: TAX_B, partner_email: "x@y.vn" }))).toBe(
      "PARTNER_NOT_IN_COMPANY",
    );
    expect(
      await codeOf(send(id, { partner_tax_code: TAX_A2, partner_email: "khong-phai-email" })),
    ).toBe("PARTNER_EMAIL_INVALID");
    expect(await sendsOf(id)).toBe(0);
  });
});

describe("CR-126 · fix4 · đối tác của CÔNG TY, không theo quyền xem của người gửi", () => {
  const TAX_C1 = "0107777771"; // đối tác trên HĐ của người gửi
  const TAX_C2 = "0107777772"; // đối tác thêm tay bởi người khác — người gửi KHÔNG thấy khi chế độ xem 'org'
  let C = "";
  let UC = "";
  let UC2 = "";
  let CC = "";
  const sendC = (extra: Record<string, unknown>) =>
    partnerSendTool({ uow: uow() }).run(
      { tenantId: C, userId: UC, runId: null, processRunId: null },
      { contract_id: CC, ...extra },
    );
  beforeAll(async () => {
    [C] = (await tenants(o, 1, 1370)) as [string];
    [UC, UC2] = (await users(o, C, 2, { from: 1370 })) as [string, string];
    CC = await contractWith(C, UC, 1370, TAX_C1, "c1@doitacc.vn");
    await o`insert into contracts.partner_roles (tenant_id, party_key, role, name, created_from, created_by)
      values (${C}, ${`tax:${TAX_C2}`}, 'supplier', 'Đối tác C2', 'manual', ${UC2})`;
    await o`insert into contracts.visibility_settings (tenant_id, mode) values (${C}, 'org')
      on conflict (tenant_id) do update set mode = 'org'`;
  }, 60_000);

  it("(a) chế độ 'org', nhân viên không phải người thêm đối tác ⇒ vẫn gửi được cho đối tác của công ty", async () => {
    // tiền đề: người gửi KHÔNG thấy hàng đối tác qua RLS (lý do lỗi cũ)
    const seen = await uow().tenant({ tenantId: C, userId: UC }, (r) =>
      r.partnerSend.isPartner(TAX_C2),
    );
    expect(seen).toBe(false);
    const r = await sendC({ partner_tax_code: TAX_C2, partner_email: "nhan@doitacc2.vn" });
    expect(r).toMatchObject({ status: "sent", channel: "email" });
    const [m] =
      await o`select to_email from hub.partner_mailbox where id = ${r.mailbox_id as string}::uuid`;
    expect(m?.to_email).toBe("nhan@doitacc2.vn");
  });

  it("(b) MST đối tác của công ty khác ⇒ PARTNER_NOT_IN_COMPANY, không ghi lần gửi mới", async () => {
    const before = await sendsOf(CC);
    expect(await codeOf(sendC({ partner_tax_code: TAX_B, partner_email: "x@y.vn" }))).toBe(
      "PARTNER_NOT_IN_COMPANY",
    );
    expect(await sendsOf(CC)).toBe(before);
  });
});

describe("CR-126 · trang chi tiết HĐ · thẻ duyệt/FlowView mang prefill của bước chọn đối tác", () => {
  const TAX_D = "0108888881";
  const TAX_D2 = "0108888882";
  let D = "";
  let UAs = ""; // người tạo HĐ
  let UM = ""; // nhóm phụ trách gửi đối tác (can_act)
  let GM = "";
  let CD = "";
  let edb: HubDb;
  const nodeBase = (key: string, name: string, step: number) => ({
    key,
    name,
    step,
    instruction: "",
    output: { filename: `${key}.md`, template: "x", required_sections: ["x"], fields: [] },
    real_action: false,
    answerer: { kind: "starter" },
    token_budget: null,
    node: PARTNER_SEND_KEY,
  });
  const STAGES = () => [
    {
      ...nodeBase("chon-doi-tac", "Chọn đối tác & người nhận", 0),
      executor: {
        kind: "form",
        fields: [
          {
            key: "partner_tax_code",
            label: "Đối tác",
            type: "select",
            required: true,
            options: [],
            options_from: "company_partners",
          },
          { key: "partner_email", label: "Email", type: "text", required: true, max_len: 254 },
        ],
      },
      after: {
        kind: "review",
        group_id: null,
        group_key: "pb-doi-tac",
        back_to_steps: [],
        remind_every_h: null,
        escalate: null,
        branch: [],
        exclude_starter: false,
      },
    },
    {
      ...nodeBase("gui", "Gửi", 1),
      real_action: true,
      executor: { kind: "tool", tool_key: "contracts-partner-send", args: {} },
      after: { kind: "auto", branch: [] },
    },
    {
      ...nodeBase("cho", "Chờ phản hồi", 2),
      executor: { kind: "wait_event", event: "partner.confirmed", timeout_h: 24 },
      after: { kind: "auto", branch: [] },
    },
  ];
  const pipe: unknown = new Proxy(
    {},
    { get: (_, k) => (k === "exec" ? async () => [] : () => pipe) },
  );
  function deps(): ProcessDeps {
    const d = {
      db: edb,
      config: {
        user: async (uid: string) => ({
          active: true,
          groupIds: new Set<string>(uid === UM ? [GM] : []),
        }),
        poll: async () => {},
        catalog: async () => ({
          features: [{ id: "f-partner", key: "contracts-partner-confirm", status: "on" }],
          entitled: new Set([`${D}:f-partner`]),
          grantGroups: new Map(),
        }),
      },
      redis: { pipeline: () => pipe },
      notifier: new Proxy({}, { get: () => async () => [] }),
      log: { warn: () => {}, info: () => {}, error: () => {} },
      now: () => new Date(),
      runsPerTenant: 100,
      postThread: async () => {},
    } as unknown as ProcessDeps & { launcher: unknown };
    d.launcher = createStageLauncher(d as never);
    return d;
  }
  const dUow = () =>
    createPackUow(edb, "contracts", (tx, tid) => ({
      approval: approvalRepo(tx, tid),
      approvalEngine: approvalEngineRepo(tx, tid),
      contractFlow: contractFlowRepo(tx, tid),
    }));
  function ad() {
    const port = packRunsOf(deps());
    const u = dUow();
    const jobs = { enqueue: async () => {} };
    return {
      uow: u,
      flow: { prepare: async () => ({ on: true, departments: null }) },
      jobs,
      groups: {
        idsOf: async () => new Map(),
        userGroups: async () => new Set(),
        actionsOf: async () => new Set(["read", "write"]),
      },
      card: engineCard({ port: () => port, uow: u, jobs } as never),
    } as never;
  }
  type PCard = { can_act: boolean; steps: { kind: string; form?: { prefill?: unknown } }[] };
  const cardOf = (userId: string) =>
    getApproval(ad())({ tenantId: D, userId }, CD) as Promise<PCard | null>;

  beforeAll(async () => {
    edb = connectDb(urls().hubApi, 6);
    [D] = (await tenants(o, 1, 1380)) as [string];
    [UAs, UM] = (await users(o, D, 2, { from: 1380 })) as [string, string];
    const roles = (await enablePack(o, [D], "contracts")).get(D);
    await members(o, D, roles?.editor as string, [UAs]);
    await members(o, D, roles?.viewer as string, [UM]);
    await visibility(o, [D], "org");
    await department(o, D, "pb-kd", { head: UAs, members: [UAs] });
    GM = await department(o, D, "pb-doi-tac", { head: UM, members: [UM] });
    CD = await contractWith(D, UAs, 1380, TAX_D, "mac-dinh@doitacd.vn");
    await o`update contracts.contracts set status = 'needs_review' where id = ${CD}`;
    await o`insert into contracts.partner_roles (tenant_id, party_key, role, name, created_from, created_by)
      values (${D}, ${`tax:${TAX_D2}`}, 'supplier', 'Đối tác D2', 'manual', ${UAs})`;
    const st = JSON.stringify(STAGES());
    const [r] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, published_version, enabled)
      values (null, 'cr126-partner-pick', 'Gửi đối tác', ${st}::text::jsonb,
      '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true) returning id::text as id`;
    const lib = r?.id as string;
    await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${lib}, 1, 'Gửi đối tác', ${st}::text::jsonb)`;
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${D}, ${lib}, true)`;
    await withHubScope(edb, { kind: "system" }, (tx) => setFlowTriggers(tx, D, true));
    registerOutcomeHandler(contractsOutcomeHandler());
    registerFactsReader(contractsFactsReader(edb));
    formPrefillRegistry.register(PARTNER_SEND_KEY, partnerPrefill(uow())); // như `mountPartnerSend`
    const wa = { tenantId: D, userId: UAs };
    expect(await startApproval(ad())(wa, CD, "level1")).toBe("ok");
    expect(await actApproval(ad())(wa, CD, { action: "approve" })).not.toHaveProperty("error");
    expect(await dispatchOnce({ db: edb, launch: flowLaunchOf(deps()) })).toMatchObject({
      launched: 1,
    });
  }, 120_000);
  afterAll(async () => {
    unregisterFlowPorts("contracts");
    await edb?.close();
  });

  it("người được giao (can_act): thẻ + FlowView có prefill = đối tác của công ty + mặc định của HĐ", async () => {
    const card = (await cardOf(UM)) as PCard;
    expect(card.can_act).toBe(true);
    const step = card.steps.find((s) => s.kind === "form");
    expect(step).toBeDefined();
    const view = flowViewOfCard(card as never, CD, 1);
    const prefill = view.tasks[0]?.prefill;
    const vals = (prefill?.field_options.partner_tax_code ?? []).map((x) => x.value);
    expect(vals).toEqual(expect.arrayContaining([TAX_D, TAX_D2]));
    expect(prefill?.field_defaults.partner_tax_code).toBe(TAX_D);
  });

  it("người không được giao: không có prefill (không lộ danh sách đối tác)", async () => {
    {
      const card = (await cardOf(UAs)) as PCard; // người tạo HĐ: xem được thẻ nhưng không quyết bước
      expect(card.can_act).toBe(false);
      expect(card.steps.find((s) => s.kind === "form")?.form?.prefill).toBeUndefined();
      expect(flowViewOfCard(card as never, CD, 1).tasks).toEqual([]);
    }
  });
});
