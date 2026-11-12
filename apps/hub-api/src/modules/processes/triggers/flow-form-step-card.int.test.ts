// CR-125 · cr125-form-step-card · bước «Điền thông tin» (form) của lượt flow hiện trên thẻ HĐ: thẻ chiếu `kind: form` + trường + task «Gửi» cho
// ĐÚNG nhóm làm; gửi qua đường ghi sẵn có của engine (`GateService.formSubmit` = `POST /review-tasks/:id/form`) ⇒ giá trị lưu ở output của
// stage, bước kế (Duyệt) mở, thẻ của người xem sau thấy giá trị đã gửi. Người ngoài nhóm làm ⇒ 404; người công ty khác ⇒ 404 (không lộ).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import {
  contracts,
  department,
  enablePack,
  members,
  tenantId,
  users,
  visibility,
} from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import type { AuthUser } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { AttachmentService } from "../../attachments/attachments.service";
import { linkRunFiles } from "../../attachments/public";
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
} from "../../packs/contracts/testing";
import { createPackUow } from "../../packs/kit/adapters/pack-uow";
import {
  registerFactsReader,
  registerOutcomeHandler,
  unregisterFlowPorts,
} from "../adapters/runs/flow-ports";
import type { ProcessDeps } from "../core/ports";
import { GateService } from "../gates/gates.service";
import { createStageLauncher } from "../runs/launcher";
import { packRunsOf } from "../runs/pack-runs";
import { dispatchOnce } from "./dispatcher";
import { setFlowTriggers } from "./flags";
import { flowLaunchOf } from "./flow-launch";

const T = tenantId(1341);
const T2 = tenantId(1342);
let A = ""; // nhân viên tạo HĐ
let B = ""; // trưởng Kế toán (người duyệt bước sau)
let M = ""; // nhân viên Mua hàng (nhóm làm bước form)
let X = ""; // người công ty khác
let D = ""; // người cùng công ty, không dính lượt (người ngoài)
let GB = "";
let GM = "";
let C = "";
let o: Sql;
let db: Db;

const base = (key: string, name: string, step: number, fields: object[]) => ({
  key,
  name,
  step,
  instruction: "",
  output: { filename: `${key}.md`, template: "x", required_sections: ["x"], fields },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
});
const review = (groupKey: string) => ({
  kind: "review",
  group_id: null,
  group_key: groupKey,
  back_to_steps: [],
  remind_every_h: null,
  escalate: null,
  branch: [],
  exclude_starter: false,
});
/** 0 Lập báo giá (form · Mua hàng) · 1 Kế toán duyệt · 2 Kết thúc. */
const STAGES = [
  {
    ...base("bao-gia", "Lập báo giá", 0, [
      { key: "nha_cung_cap", type: "string", required: false },
      { key: "gia_bao", type: "number", required: false },
      { key: "tep_bao_gia", type: "string", required: false },
    ]),
    executor: {
      kind: "form",
      fields: [
        { key: "nha_cung_cap", type: "text", label: "Nhà cung cấp", max_len: 200, required: true },
        { key: "gia_bao", type: "money", label: "Giá báo", min: 0, required: false },
        { key: "tep_bao_gia", type: "file_ref", label: "Tệp báo giá", required: false },
      ],
    },
    after: review("pb-mua-hang"),
  },
  {
    ...base("duyet", "Kế toán duyệt", 1, [{ key: "decision", type: "string", required: true }]),
    executor: { kind: "approve", reject_step: null, return_step: null },
    after: review("pb-ke-toan"),
  },
  {
    ...base("xong", "Đã duyệt", 2, []),
    executor: { kind: "set", values: [] },
    after: { kind: "auto", branch: [] },
    outcome: "approved",
  },
];
const FILE = "7c1d2b6e-0000-4000-8000-0000000000aa"; // tệp M tải lên (ô file_ref của bước form)
const FILE_A = "7c1d2b6e-0000-4000-8000-0000000000ab"; // tệp của A (M không được kéo vào lượt)

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  await o`insert into admin.tenants (id, key, name) values (${T}, 't1341', 'T'), (${T2}, 't1342', 'T2')`;
  [A, B, M] = (await users(o, T, 3, { from: 1341 })) as [string, string, string];
  [X] = (await users(o, T2, 1, { from: 1350 })) as [string];
  [D] = (await users(o, T, 1, { from: 1345 })) as [string];
  const roles = (await enablePack(o, [T], "contracts")).get(T);
  await members(o, T, roles?.editor as string, [A]);
  await members(o, T, roles?.viewer as string, [B, M]);
  await visibility(o, [T], "org");
  await department(o, T, "pb-kd", { head: A, members: [A] });
  GB = await department(o, T, "pb-ke-toan", { head: B, members: [B] });
  GM = await department(o, T, "pb-mua-hang", { head: M, members: [M] });
  [C] = (await contracts(o, T, 1, { from: 1341, createdBy: A, status: "needs_review" })) as [
    string,
  ];
  await o`update contracts.contracts set deal = 'buy', direction = 'purchase',
    fields = jsonb_build_object('total_value', jsonb_build_object('value', 150000000)) where id = ${C}`;
  for (const [id, owner, name] of [
    [FILE, M, "bao-gia.txt"],
    [FILE_A, A, "rieng-tu.txt"],
  ] as const)
    await o`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256, storage_key)
      values (${id}, ${T}, ${owner}, 'upload', ${name}, ${name}, 'text/plain', 5, ${"a".repeat(64)}, ${`${T}/${id}`})`;
  const st = JSON.stringify(STAGES);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger,
      app, published_version, enabled) values (null, 'cr125-form-card', 'Mua hàng', ${st}::text::jsonb,
      '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true) returning id::text as id`;
  const lib = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${lib}, 1, 'Mua hàng', ${st}::text::jsonb)`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${T}, ${lib}, true)`;
  await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, T, true));
  registerOutcomeHandler(contractsOutcomeHandler());
  registerFactsReader(contractsFactsReader(db));
}, 120_000);
afterAll(async () => {
  unregisterFlowPorts("contracts");
  await db?.close();
  await o?.end({ timeout: 2 });
});

const pipe: unknown = new Proxy(
  {},
  { get: (_, k) => (k === "exec" ? async () => [] : () => pipe) },
);
function deps(): ProcessDeps {
  const groups: Record<string, string[]> = { [B]: [GB], [M]: [GM] };
  const d = {
    db,
    config: {
      user: async (uid: string) => ({ active: true, groupIds: new Set<string>(groups[uid] ?? []) }),
      poll: async () => {},
      catalog: async () => ({ features: [], entitled: new Set(), grantGroups: new Map() }),
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
const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    approval: approvalRepo(tx, tid),
    approvalEngine: approvalEngineRepo(tx, tid),
    contractFlow: contractFlowRepo(tx, tid),
  }));
function ad() {
  const port = packRunsOf(deps());
  const u = uow();
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
type Step = {
  name: string;
  kind: string;
  status: string;
  group_id: string | null;
  form?: { fields: { key: string }[] };
  values?: Record<string, unknown>;
};
type Card = { task_id: string | null; can_act: boolean; steps: Step[] };
const cardOf = (userId: string, tenant = T) =>
  getApproval(ad())({ tenantId: tenant, userId }, C) as Promise<Card | null>;
const asUser = (userId: string, tenantId: string) =>
  ({ userId, tenantId, role: "member", userKind: "internal" }) as unknown as AuthUser;
const VALUES = { nha_cung_cap: "Công ty An Phát", gia_bao: 480_000_000, tep_bao_gia: FILE };

describe("CR-125 · bước form trên thẻ HĐ", () => {
  it("thẻ: bước form mở với trường + nhóm làm; chỉ nhóm làm có task «Gửi»", async () => {
    const wa = { tenantId: T, userId: A };
    expect(await startApproval(ad())(wa, C, "level1")).toBe("ok");
    expect(await dispatchOnce({ db, launch: flowLaunchOf(deps()) })).toMatchObject({ launched: 1 });

    const mine = (await cardOf(M)) as Card;
    expect(mine.steps.map((s) => `${s.name}:${s.kind}:${s.status}`)).toEqual([
      "Lập báo giá:form:open",
    ]);
    expect(mine.steps[0]?.group_id).toBe(GM);
    expect(mine.steps[0]?.form?.fields.map((f) => f.key)).toEqual([
      "nha_cung_cap",
      "gia_bao",
      "tep_bao_gia",
    ]);
    expect(mine.can_act).toBe(true);
    const view = flowViewOfCard(mine as never, C, 1);
    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0]).toMatchObject({ kind: "form", step_key: "bao-gia" });
    expect(view.tasks[0]?.actions.map((a) => a.key)).toEqual(["submit"]);

    const other = (await cardOf(A)) as Card; // người tạo HĐ: thấy bước form nhưng không có việc
    expect(other.can_act).toBe(false);
    expect(flowViewOfCard(other as never, C, 1).tasks).toEqual([]);
  });

  it("quyền: người ngoài nhóm làm ⇒ 404; người công ty khác ⇒ 404; bước vẫn mở", async () => {
    const taskId = ((await cardOf(M)) as Card).task_id as string;
    const gates = new GateService(deps());
    await expect(gates.formSubmit(asUser(B, T), taskId, { values: VALUES })).rejects.toMatchObject({
      status: 404,
    });
    await expect(gates.formSubmit(asUser(X, T2), taskId, { values: VALUES })).rejects.toMatchObject(
      {
        status: 404,
      },
    );
    expect(((await cardOf(M)) as Card).steps[0]?.status).toBe("open");
  });
});

describe("CR-125 · bước form trên thẻ HĐ · giá trị, tệp", () => {
  it("giá trị sai ⇒ 422 FORM_VALUES_INVALID, bước vẫn mở; đúng ⇒ lưu output, bước Duyệt mở, thẻ người xem sau có giá trị", async () => {
    const taskId = ((await cardOf(M)) as Card).task_id as string;
    const gates = new GateService(deps());
    await expect(
      gates.formSubmit(asUser(M, T), taskId, { values: { gia_bao: 1 } }),
    ).rejects.toMatchObject({ code: "FORM_VALUES_INVALID" });

    await gates.formSubmit(asUser(M, T), taskId, { values: VALUES });
    const [out] = await o<{ fields: Record<string, unknown> }[]>`select o.fields
      from hub.process_outputs o join hub.stage_runs s on s.current_output_id = o.id
      join hub.process_runs r on r.id = s.process_run_id
      where r.tenant_id = ${T} and r.pack_record_id = ${C} and s.stage_idx = 0`;
    expect(out?.fields).toEqual(VALUES);

    const after = (await cardOf(B)) as Card;
    expect(after.steps.map((s) => `${s.name}:${s.kind}:${s.status}`)).toEqual([
      "Lập báo giá:form:passed",
      "Kế toán duyệt:review:open",
    ]);
    expect(after.steps[0]?.values).toEqual(VALUES);
    expect(after.can_act).toBe(true);
    expect(flowViewOfCard(after as never, C, 1).tasks[0]?.kind).toBe("review");
    // gửi lại cùng giá trị ⇒ idempotent (không lỗi)
    await gates.formSubmit(asUser(M, T), taskId, { values: VALUES });
  });
});

describe("CR-125 · bước form trên thẻ HĐ · tệp", () => {
  it("tệp bước form: người xem lượt (Kế toán, người tạo) mở được; người ngoài cùng công ty 404; công ty khác 404; không kéo tệp người khác vào lượt", async () => {
    const files = new AttachmentService({ db, storage: {} as never, tenantMaxBytes: 1 });
    const detail = (uid: string, tid = T) => files.get(asUser(uid, tid), FILE);
    expect(await detail(B)).toMatchObject({ id: FILE, filename: "bao-gia.txt" });
    expect(await detail(A)).toMatchObject({ id: FILE });
    await expect(detail(D)).rejects.toMatchObject({ status: 404 });
    await expect(detail(X, T2)).rejects.toMatchObject({ status: 404 });
    // tệp của A mà M cố liên kết vào lượt ⇒ 0 hàng (chỉ tệp của chính người thao tác); D vẫn không mở được.
    const [run] = await o<
      { id: string }[]
    >`select id from hub.process_runs where tenant_id = ${T} and pack_record_id = ${C}`;
    const linked = await withHubScope(db, { kind: "user", tenantId: T, userId: M }, (tx) =>
      linkRunFiles(tx, {
        tenantId: T,
        userId: M,
        runId: run?.id as string,
        ids: [FILE_A],
        source: "form",
      }),
    );
    expect(linked).toBe(0);
    await expect(files.get(asUser(D, T), FILE_A)).rejects.toMatchObject({ status: 404 });
  });
});
