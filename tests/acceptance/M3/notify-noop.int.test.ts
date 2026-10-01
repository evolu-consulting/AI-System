// ADM-FR-53 · M3-AC05 · KHÔNG đổi gì / lỗi luật / sổ sách đăng nhập → config_version KHÔNG tăng và KHÔNG có NOTIFY nào
// (test-plan I-N, N-B; M3-R15, R16). Kiểm bằng sentinel (không sleep). Mỗi `it` tự reset dữ liệu.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  callerOf,
  createM3Env,
  EXT,
  ID,
  ID3,
  type Listener,
  type M3Env,
  PW,
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

type Op = { code: string; title: string; status: number; run: () => Promise<Res> };
const KT = ID3.group.acmeKeToan;
const ent = (f: string, t: string) => `/admin/features/${f}/entitlements/${t}`;
/** PATCH với `version` hiện tại và các trường lấy NGUYÊN từ bản đang lưu (không đổi gì). */
const samePatch = async (
  call: typeof admin,
  table: string,
  id: string,
  path: string,
  pick: string[],
) => {
  const cur = (await call("GET", path)).json as Record<string, unknown>;
  const body: Record<string, unknown> = { version: await verOf(env, table, id) };
  for (const k of pick) body[k] = cur[k];
  return call("PATCH", path, body);
};
const login = (username: string, password: string, headers?: Record<string, string>) =>
  env.call("POST", "/auth/login", { headers, body: { tenant_key: "acme", username, password } });

const OPS: Op[] = [
  {
    code: "N40",
    title: "PATCH group không đổi",
    status: 200,
    run: () => samePatch(binh, "groups", KT, `/admin/groups/${KT}`, ["name", "description"]),
  },
  {
    code: "N41",
    title: "members add toàn đã có (already)",
    status: 200,
    run: () => binh("POST", `/admin/groups/${KT}/members`, { usernames: ["lan", "thu"] }),
  },
  {
    code: "N42",
    title: "members add dry_run (có người mới)",
    status: 200,
    run: () => binh("POST", `/admin/groups/${KT}/members`, { usernames: ["dung"], dry_run: true }),
  },
  {
    code: "N43",
    title: "members remove người không phải thành viên",
    status: 204,
    run: () => binh("DELETE", `/admin/groups/${KT}/members/${USER_ID.an}`),
  },
  {
    code: "N44",
    title: "POST grant đã có (200)",
    status: 200,
    run: () => binh("POST", "/admin/grants", { feature_id: ID.feature.keToan, group_id: KT }),
  },
  {
    code: "N45",
    title: "DELETE grant không có",
    status: 204,
    run: () => binh("DELETE", `/admin/grants?feature_id=${ID.feature.dichThuat}&group_id=${KT}`),
  },
  {
    code: "N46",
    title: "batch toàn unchanged",
    status: 200,
    run: () =>
      binh("PUT", "/admin/grants/batch", {
        add: [{ feature_id: ID.feature.keToan, group_id: KT }],
        remove: [{ feature_id: ID.feature.dichThuat, group_id: KT }],
      }),
  },
  {
    code: "N47",
    title: "batch bị 400 (một phần tử sai)",
    status: 400,
    run: () =>
      binh("PUT", "/admin/grants/batch", {
        add: [
          { feature_id: ID.feature.dichThuat, group_id: KT },
          { feature_id: ID3.unknown, group_id: KT },
        ],
      }),
  },
  {
    code: "N48",
    title: "PATCH feature không đổi",
    status: 200,
    run: () =>
      samePatch(admin, "features", ID.feature.keToan, `/admin/features/${ID.feature.keToan}`, [
        "status",
      ]),
  },
  {
    code: "N49",
    title: "PUT entitlement đã active",
    status: 200,
    run: () => admin("PUT", ent(ID.feature.keToan, TENANT_ID.acme)),
  },
  {
    code: "N50",
    title: "DELETE entitlement đã thu hồi (giả định idempotent 204, G9)",
    status: 204,
    run: () => admin("DELETE", ent(ID.feature.keToan, TENANT_ID.globex)),
  },
  {
    code: "N51",
    title: "PATCH workflow không đổi",
    status: 200,
    run: () =>
      samePatch(
        admin,
        "workflows",
        ID.workflow.translate,
        `/admin/workflows/${ID.workflow.translate}`,
        ["name"],
      ),
  },
  {
    code: "N52",
    title: "PATCH command không đổi",
    status: 200,
    run: () =>
      samePatch(admin, "commands", ID.command.dich, `/admin/commands/${ID.command.dich}`, [
        "description",
      ]),
  },
  {
    code: "N53",
    title: "PATCH tenant không đổi",
    status: 200,
    run: () =>
      samePatch(admin, "tenants", TENANT_ID.acme, `/admin/tenants/${TENANT_ID.acme}`, ["name"]),
  },
  {
    code: "N54",
    title: "PATCH user không đổi",
    status: 200,
    run: () =>
      samePatch(binh, "users", USER_ID.lan, `/admin/users/${USER_ID.lan}`, ["display_name"]),
  },
  {
    code: "N55",
    title: "PATCH secret cùng ghi chú",
    status: 200,
    run: () =>
      admin("PATCH", "/admin/secrets/DIFY_TRANSLATE_KEY", { note: "App Translate trên Dify prod" }),
  },
  {
    code: "N56",
    title: "lock user đã khoá (em inactive)",
    status: 200,
    run: () => binh("POST", `/admin/users/${USER_ID.em}/lock`),
  },
  {
    code: "N57",
    title: "lock tenant đã khoá (zeta)",
    status: 200,
    run: () => admin("POST", `/admin/tenants/${TENANT_ID.zeta}/lock`),
  },
  {
    code: "N58",
    title: "unlock user chỉ có khoá tạm (locked_until), active=true",
    status: 200,
    run: async () => {
      await env.owner`update admin.users set failed_logins = 3, locked_until = now() + interval '1 hour' where id = ${USER_ID.lan}`;
      return binh("POST", `/admin/users/${USER_ID.lan}/unlock`);
    },
  },
  {
    code: "N59",
    title: "đăng nhập thành công (last_login_at, refresh_tokens)",
    status: 200,
    run: () => login("lan", PW),
  },
  {
    code: "N60",
    title: "refresh token (extension)",
    status: 200,
    run: async () => {
      const s = await login("an", PW, EXT);
      return env.call("POST", "/auth/refresh", {
        headers: EXT,
        body: { refresh_token: s.json.refresh_token },
      });
    },
  },
  {
    code: "N61",
    title: "tự đổi mật khẩu",
    status: 204,
    run: async () =>
      env.call("POST", "/auth/change-password", {
        token: await env.token("acme", "chi"),
        body: { current_password: PW, new_password: "Moi-Passw0rd-77" },
      }),
  },
  {
    code: "N62",
    title: "reset-password (admin đặt mật khẩu tạm)",
    status: 200,
    run: () => binh("POST", `/admin/users/${USER_ID.dung}/reset-password`),
  },
  {
    code: "N63",
    title: "logout-all",
    status: 204,
    run: () => binh("POST", `/admin/users/${USER_ID.lan}/logout-all`),
  },
  {
    code: "N64",
    title: "đăng nhập sai nhiều lần (failed_logins, locked_until)",
    status: 401,
    run: async () => {
      await login("thu", "sai-mat-khau-1");
      await login("thu", "sai-mat-khau-2");
      return login("thu", "sai-mat-khau-3");
    },
  },
];

describe("ADM-FR-53 · M3-AC05 · không đổi / lỗi / sổ sách → không bump, không NOTIFY", () => {
  for (const op of OPS) {
    it(`ADM-FR-53 · M3-AC05 · ${op.code} · ${op.title} → ${op.status}, config_version KHÔNG đổi, KHÔNG NOTIFY`, async () => {
      const { res, v0, v1, msgs } = await track(env, lis, op.run);
      expect([op.code, res.status]).toEqual([op.code, op.status]);
      expect(v1).toBe(v0);
      expect(msgs).toEqual([]);
    });
  }
});
