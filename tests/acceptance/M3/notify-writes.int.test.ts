// ADM-FR-53 · M3-AC05 · mọi lệnh ghi cấu hình có đổi dữ liệu của M1/M2/M3 (bảng plan §5.3) → config_version +1 đúng một lần
// và ĐÚNG MỘT NOTIFY `config_changed` (đúng entity, tenant_id) — 33 thao tác (test-plan I-N, N-A). Kiểm bằng listener LISTEN
// riêng (đóng vai Hub) + sentinel (không sleep). Mỗi `it` tự reset dữ liệu; không `it` nào đọc kết quả của `it` khác.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { ConfigEntity } from "@ai/contracts";
import {
  callerOf,
  createM3Env,
  ID,
  ID3,
  LEAK_1,
  LEAK_2,
  type Listener,
  type M3Env,
  type Res,
  TENANT_ID,
  USER_ID,
} from "./_fixtures";
import { track, verOf } from "./_notify";

let env: M3Env;
let lis: Listener;
let admin: ReturnType<typeof callerOf>;
let binh: ReturnType<typeof callerOf>;

beforeAll(async () => {
  env = await createM3Env();
  lis = await env.listen();
  admin = callerOf(env, "platform", "admin");
  binh = callerOf(env, "acme", "binh");
});
beforeEach(async () => {
  await env.reset3();
});
afterAll(async () => {
  await env.close();
});

type Want = string | null | ((r: Res) => string);
type Op = {
  code: string;
  title: string;
  entity: ConfigEntity;
  tenant: Want;
  run: () => Promise<Res>;
};

const KT = ID3.group.acmeKeToan;
const KD = ID3.group.acmeKinhDoanh;
const ent = (f: string, t: string) => `/admin/features/${f}/entitlements/${t}`;
const wfBody = {
  key: "moi-wf",
  name: "Moi",
  description: "d".repeat(30),
  app_type: "workflow",
  base_url: "https://x.example.com",
  secret_id: ID.secret.old,
};
const cmdBody = {
  name: "moi-cmd",
  description: { vi: "Mô tả" },
  workflow_id: ID.workflow.reportTax,
  output: { field: "text", render: "text" },
};
const patchOf = async (
  call: typeof admin,
  table: string,
  id: string,
  path: string,
  over: unknown,
) => call("PATCH", path, { version: await verOf(env, table, id), ...(over as object) });

const OPS: Op[] = [
  {
    code: "N01",
    title: "POST tenant (ghi tenant + admin đầu + beta-testers = 3 bảng)",
    entity: "tenant",
    tenant: (r) => r.json.tenant.id,
    run: () =>
      admin("POST", "/admin/tenants", {
        key: "initech",
        name: "Initech",
        first_admin: {
          username: "lumbergh",
          display_name: "Bill",
          email: "bill@initech.test",
          locale: "en",
        },
      }),
  },
  {
    code: "N02",
    title: "PATCH tenant (đổi tên)",
    entity: "tenant",
    tenant: TENANT_ID.acme,
    run: () =>
      patchOf(admin, "tenants", TENANT_ID.acme, `/admin/tenants/${TENANT_ID.acme}`, {
        name: "Acme 2",
      }),
  },
  {
    code: "N03",
    title: "lock tenant",
    entity: "tenant",
    tenant: TENANT_ID.globex,
    run: () => admin("POST", `/admin/tenants/${TENANT_ID.globex}/lock`),
  },
  {
    code: "N04",
    title: "unlock tenant (zeta đang khoá)",
    entity: "tenant",
    tenant: TENANT_ID.zeta,
    run: () => admin("POST", `/admin/tenants/${TENANT_ID.zeta}/unlock`),
  },
  {
    code: "N05",
    title: "POST user",
    entity: "user",
    tenant: TENANT_ID.acme,
    run: () =>
      admin("POST", `/admin/users?tenant_id=${TENANT_ID.acme}`, {
        username: "moi",
        display_name: "Moi",
        role: "member",
      }),
  },
  {
    code: "N06",
    title: "PATCH user (display_name)",
    entity: "user",
    tenant: TENANT_ID.acme,
    run: () =>
      patchOf(binh, "users", USER_ID.lan, `/admin/users/${USER_ID.lan}`, { display_name: "Lan 2" }),
  },
  {
    code: "N07",
    title: "lock user (active → false)",
    entity: "user",
    tenant: TENANT_ID.acme,
    run: () => binh("POST", `/admin/users/${USER_ID.lan}/lock`),
  },
  {
    code: "N08",
    title: "unlock user (active false → true: em)",
    entity: "user",
    tenant: TENANT_ID.acme,
    run: () => binh("POST", `/admin/users/${USER_ID.em}/unlock`),
  },
  {
    code: "N09",
    title: "POST group",
    entity: "group",
    tenant: TENANT_ID.acme,
    run: () => binh("POST", "/admin/groups", { key: "moi-nhom", name: { vi: "Mới" } }),
  },
  {
    code: "N10",
    title: "PATCH group (đổi tên)",
    entity: "group",
    tenant: TENANT_ID.acme,
    run: () => patchOf(binh, "groups", KT, `/admin/groups/${KT}`, { name: { vi: "KT 2" } }),
  },
  {
    code: "N11",
    title: "DELETE group (kinh-doanh)",
    entity: "group",
    tenant: TENANT_ID.acme,
    run: () => binh("DELETE", `/admin/groups/${KD}`),
  },
  {
    code: "N12",
    title: "members add ≥ 1 mới",
    entity: "group",
    tenant: TENANT_ID.acme,
    run: () => binh("POST", `/admin/groups/${KD}/members`, { usernames: ["dung"] }),
  },
  {
    code: "N13",
    title: "members remove (có thật)",
    entity: "group",
    tenant: TENANT_ID.acme,
    run: () => binh("DELETE", `/admin/groups/${KT}/members/${USER_ID.lan}`),
  },
  {
    code: "N14",
    title: "POST grant mới (201)",
    entity: "grant",
    tenant: TENANT_ID.acme,
    run: () => binh("POST", "/admin/grants", { feature_id: ID.feature.dichThuat, group_id: KT }),
  },
  {
    code: "N15",
    title: "DELETE grant có thật",
    entity: "grant",
    tenant: TENANT_ID.acme,
    run: () => binh("DELETE", `/admin/grants?feature_id=${ID.feature.keToan}&group_id=${KT}`),
  },
  {
    code: "N16",
    title: "PUT batch (thêm + bớt) → entity grant, không 'batch'",
    entity: "grant",
    tenant: TENANT_ID.acme,
    run: () =>
      binh("PUT", "/admin/grants/batch", {
        add: [{ feature_id: ID.feature.dichThuat, group_id: KT }],
        remove: [{ feature_id: ID.feature.keToan, group_id: KT }],
      }),
  },
  {
    code: "N17",
    title: "POST feature",
    entity: "feature",
    tenant: null,
    run: () =>
      admin("POST", "/admin/features", { key: "nhan-su", name: { vi: "Nhân sự" }, status: "on" }),
  },
  {
    code: "N18",
    title: "PATCH feature (status)",
    entity: "feature",
    tenant: null,
    run: () =>
      patchOf(admin, "features", ID.feature.keToan, `/admin/features/${ID.feature.keToan}`, {
        status: "beta",
      }),
  },
  {
    code: "N19",
    title: "PATCH feature (command_ids)",
    entity: "feature",
    tenant: null,
    run: () =>
      patchOf(admin, "features", ID.feature.thuNghiem, `/admin/features/${ID.feature.thuNghiem}`, {
        command_ids: [ID.command.tomTat],
      }),
  },
  {
    code: "N20",
    title: "DELETE feature (thu-nghiem)",
    entity: "feature",
    tenant: null,
    run: () => admin("DELETE", `/admin/features/${ID.feature.thuNghiem}`),
  },
  {
    code: "N21",
    title: "PUT entitlement cấp mới (zeta)",
    entity: "entitlement",
    tenant: TENANT_ID.zeta,
    run: () => admin("PUT", ent(ID.feature.keToan, TENANT_ID.zeta)),
  },
  {
    code: "N22",
    title: "PUT entitlement cấp lại (globex ke-toan đã thu hồi)",
    entity: "entitlement",
    tenant: TENANT_ID.globex,
    run: () => admin("PUT", ent(ID.feature.keToan, TENANT_ID.globex)),
  },
  {
    code: "N23",
    title: "DELETE entitlement (thu hồi acme)",
    entity: "entitlement",
    tenant: TENANT_ID.acme,
    run: () => admin("DELETE", ent(ID.feature.keToan, TENANT_ID.acme)),
  },
  {
    code: "N24",
    title: "POST workflow",
    entity: "workflow",
    tenant: null,
    run: () => admin("POST", "/admin/workflows", wfBody),
  },
  {
    code: "N25",
    title: "PATCH workflow (đổi tên)",
    entity: "workflow",
    tenant: null,
    run: () =>
      patchOf(
        admin,
        "workflows",
        ID.workflow.reportTax,
        `/admin/workflows/${ID.workflow.reportTax}`,
        { name: "Tax 2" },
      ),
  },
  {
    code: "N26",
    title: "DELETE workflow chưa gắn (report-tax)",
    entity: "workflow",
    tenant: null,
    run: () => admin("DELETE", `/admin/workflows/${ID.workflow.reportTax}`),
  },
  {
    code: "N27",
    title: "POST command",
    entity: "command",
    tenant: null,
    run: () => admin("POST", "/admin/commands", cmdBody),
  },
  {
    code: "N28",
    title: "PATCH command (mô tả)",
    entity: "command",
    tenant: null,
    run: () =>
      patchOf(admin, "commands", ID.command.trNhanh, `/admin/commands/${ID.command.trNhanh}`, {
        description: { vi: "Mới" },
      }),
  },
  {
    code: "N29",
    title: "DELETE command (tr-nhanh)",
    entity: "command",
    tenant: null,
    run: () => admin("DELETE", `/admin/commands/${ID.command.trNhanh}`),
  },
  {
    code: "N30",
    title: "POST secret",
    entity: "secret",
    tenant: null,
    run: () => admin("POST", "/admin/secrets", { name: "DIFY_N_KEY", value: LEAK_1 }),
  },
  {
    code: "N31",
    title: "PUT secret (thay giá trị)",
    entity: "secret",
    tenant: null,
    run: () => admin("PUT", "/admin/secrets/DIFY_OLD_KEY", { value: LEAK_2 }),
  },
  {
    code: "N32",
    title: "PATCH secret (ghi chú đổi)",
    entity: "secret",
    tenant: null,
    run: () => admin("PATCH", "/admin/secrets/DIFY_OLD_KEY", { note: "đã đổi" }),
  },
  {
    code: "N33",
    title: "DELETE secret chưa dùng",
    entity: "secret",
    tenant: null,
    run: () => admin("DELETE", "/admin/secrets/DIFY_OLD_KEY"),
  },
];

describe("ADM-FR-53 · M3-AC05 · ghi có đổi → +1 và đúng một NOTIFY (plan §5.3)", () => {
  for (const op of OPS) {
    it(`ADM-FR-53 · M3-AC05 · ${op.code} · ${op.title} → thành công, config_version +1, đúng một NOTIFY entity '${op.entity}'`, async () => {
      const { res, v0, v1, msgs } = await track(env, lis, op.run);
      expect([op.code, res.status >= 200 && res.status < 300]).toEqual([op.code, true]);
      expect(v1).toBe(v0 + 1);
      expect(msgs).toHaveLength(1);
      const p = msgs[0]?.payload;
      expect(p?.v).toBe(v1);
      expect(p?.entity).toBe(op.entity);
      const want = typeof op.tenant === "function" ? op.tenant(res) : op.tenant;
      if (want === null) expect(p && "tenant_id" in p).toBe(false);
      else expect(p?.tenant_id).toBe(want);
    });
  }
});
