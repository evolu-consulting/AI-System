// CR-150 · UAT hợp đồng 2 công ty trên bản test (staging stg-test): demo = bên gửi, evolu = bên đối tác. Chạy qua `deploy/stg-test/seed-demo.sh --partner-only`.
//   demo : 3 quy trình duyệt có «Bắt đầu khi» khác nhau (xét trước «Duyệt hợp đồng»), bước Ký («Ký qua» + người ký), «Gửi đối tác xác nhận» tới evolu,
//          hồ sơ công ty (MST) + tính năng «Đối tác xác nhận» + dòng đối tác evolu trong sổ đối tác. Ghi đè quy trình UAT của chính ta (lặp lại được).
//   evolu: CHỈ THÊM — người dùng `uat-nhan-*`, nhóm `uat-nhan-*`, MỘT quy trình «Nhận HĐ từ đối tác (UAT)» (ngưỡng + người phụ trách + bước Ký), bật «cho phép tìm thấy»,
//          tính năng «Đối tác xác nhận», hồ sơ công ty NẾU còn trống. KHÔNG xoá/sửa gì có sẵn (luật ở `planEvolu`, test ở seed-demo-partner.data.test.ts).
// Mật khẩu người UAT evolu: biến `UAT_EVOLU_PW` (file UAT_EVOLU.pw trên máy chủ) — chỉ đặt cho người MỚI tạo; không in ra log.
import { hashPassword } from "@ai/db";
import postgres, { type Sql } from "postgres";
import { bindGroupKeys } from "../../../apps/hub-api/src/modules/processes/public";
import { type Api, adminToken, call, type Json } from "../../hub-dev/src/fixture";
import {
  DEMO_KEY,
  demoFlows,
  EVOLU_GROUPS,
  EVOLU_KEY,
  EVOLU_USERS,
  type EvoluState,
  evoluEmail,
  type FlowDef,
  flowOrder,
  PARTNER_ADDED_BY,
  PARTNER_FEATURE,
  PROFILES,
  partnerGuard,
  planEvolu,
  RECEIVE,
  receiveFlow,
  SIGN_GROUP_DEMO,
  withEsign,
} from "./seed-demo-partner.data";

const TAG = "seed-demo-partner";
const fail = (m: string): never => {
  throw new Error(m);
};
const env = (k: string): string => process.env[k] || fail(`thiếu ${k}`);
const items = (j: Json): Json[] => (j.items as Json[] | undefined) ?? [];

type Ctx = { api: Api; hub: Api; sql: Sql; tid: Record<string, string> };

// ── công ty: hồ sơ, tính năng, cho phép tìm thấy, chạy quy trình theo sự kiện ──
async function company(c: Ctx, key: string, listed: boolean): Promise<void> {
  const tid = c.tid[key] ?? fail(`không có công ty ${key}`);
  const prof = await call(c.api, "GET", `/admin/tenants/${tid}/profile`);
  if (!prof.tax_code)
    await call(c.api, "PATCH", `/admin/tenants/${tid}/profile`, {
      version: prof.version,
      ...PROFILES[key as keyof typeof PROFILES],
    });
  const feats = items(await call(c.api, "GET", "/admin/features?limit=200"));
  const fid = String(
    feats.find((f) => f.key === PARTNER_FEATURE)?.id ??
      fail(`không có tính năng ${PARTNER_FEATURE}`),
  );
  await call(c.api, "PUT", `/admin/features/${fid}/entitlements/${tid}`);
  if (listed) await call(c.api, "PUT", `/admin/tenants/${tid}/directory`, { listed: true });
  // chỉ BẬT (không tắt) — công ty đã bật sẵn giữ nguyên
  await c.sql`insert into hub.tenant_flow_settings (tenant_id, flow_triggers) values (${tid}::uuid, true)
    on conflict (tenant_id) do update set flow_triggers = true, updated_at = now() where hub.tenant_flow_settings.flow_triggers = false`;
  console.log(
    `${TAG}: ${key} — hồ sơ/tính năng/chạy theo sự kiện sẵn sàng${listed ? ", cho phép tìm thấy" : ""}`,
  );
}

// ── evolu: chỉ thêm người + nhóm ──
async function evoluState(c: Ctx): Promise<{ state: EvoluState; ids: Map<string, string> }> {
  const tid = c.tid[EVOLU_KEY] ?? "";
  const users = new Set<string>();
  for (const u of items(
    await call(c.api, "GET", `/admin/users?tenant_id=${tid}&q=uat-nhan&limit=50`),
  ))
    users.add(String(u.username));
  const ids = new Map<string, string>();
  const groups = new Map<string, Set<string>>();
  for (const g of items(await call(c.api, "GET", `/admin/groups?tenant_id=${tid}&limit=200`))) {
    ids.set(String(g.key), String(g.id));
    const wanted = [...EVOLU_GROUPS.map((x) => x.key), "contracts-owner", "contracts-editor"];
    if (!wanted.includes(String(g.key))) continue;
    const mem = await call(c.api, "GET", `/admin/groups/${String(g.id)}/members?limit=200`);
    groups.set(String(g.key), new Set(items(mem).map((m) => String(m.username))));
  }
  return { state: { users, groups }, ids };
}

async function evolu(c: Ctx): Promise<Map<string, string>> {
  const tid = c.tid[EVOLU_KEY] ?? "";
  const { state, ids } = await evoluState(c);
  const plan = planEvolu(state);
  if (plan.missingPackGroups.length)
    fail(
      `evolu chưa có nhóm gói: ${plan.missingPackGroups.join(", ")} (không tự tạo — báo điều phối)`,
    );
  const fresh: string[] = [];
  for (const a of plan.actions) {
    if (a.op === "create_user") {
      await call(c.api, "POST", `/admin/users?tenant_id=${tid}`, {
        username: a.username,
        display_name: a.name,
        role: "member",
        locale: "vi",
        email: evoluEmail(a.username),
      });
      fresh.push(a.username);
    } else if (a.op === "create_group") {
      const g = await call(c.api, "POST", `/admin/groups?tenant_id=${tid}`, {
        key: a.key,
        name: { vi: a.name },
      });
      ids.set(a.key, String(g.id));
    } else {
      const gid = ids.get(a.group) ?? fail(`thiếu nhóm ${a.group}`);
      await call(c.api, "POST", `/admin/groups/${gid}/members`, { usernames: [a.username] });
    }
  }
  if (fresh.length) {
    // mật khẩu chỉ cho người MỚI tạo (một câu SQL như seed-demo-org; không đụng người có sẵn)
    const hash = await hashPassword(env("UAT_EVOLU_PW"));
    await c.sql`update admin.users set password_hash = ${hash}, must_change_password = false, locale = 'vi', updated_at = now()
      where tenant_id = ${tid}::uuid and username = any(${fresh}::text[])`;
  }
  console.log(`${TAG}: evolu — ${plan.actions.length} thao tác THÊM (${fresh.length} người mới)`);
  return ids;
}

// ── quy trình công ty (đúng đường màn Quy trình: tạo sơ đồ trống → PUT bước → Áp dụng) ──
async function ensureFlow(
  c: Ctx,
  tid: string,
  groups: Map<string, string>,
  def: FlowDef,
  o: { overwrite: boolean },
): Promise<{ flowId: string; created: boolean }> {
  const base = `/tenants/${tid}/company-flows`;
  let row = items(await call(c.hub, "GET", base)).find((x) => x.name === def.name);
  if (row && !o.overwrite) return { flowId: String(row.flow_id), created: false };
  if (!row) {
    const made = await call(c.hub, "POST", base, {
      name: def.name,
      app: "contracts",
      from: "blank",
    });
    row = items(made).find((x) => x.flow_id === made.flow_id);
  }
  const flowId = String(row?.flow_id ?? fail(`không thấy «${def.name}» sau khi tạo`));
  const cur = await call(c.hub, "GET", `/process-defs/${flowId}?tenant_id=${tid}`);
  const bound = bindGroupKeys(def.stages, groups, { strip: true });
  if (bound.missing.length) fail(`«${def.name}» thiếu nhóm: ${bound.missing.join(", ")}`);
  await call(c.hub, "PUT", `/process-defs/${flowId}?tenant_id=${tid}`, {
    key: cur.key,
    name: cur.name,
    description: cur.description ?? "",
    input_hint: cur.input_hint ?? "",
    run_group_ids: cur.run_group_ids ?? [],
    stages: bound.stages,
    token_budget: cur.token_budget ?? null,
    enabled: true,
    sources: cur.sources ?? [],
    inputs: cur.inputs ?? [],
    trigger: def.trigger,
    app: "contracts",
    version: cur.version,
  });
  await call(c.hub, "POST", `${base}/apply`, { flow_id: flowId });
  return { flowId, created: true };
}

const groupMap = async (c: Ctx, tid: string): Promise<Map<string, string>> =>
  new Map(
    items(await call(c.api, "GET", `/admin/groups?tenant_id=${tid}&limit=200`)).map((g) => [
      String(g.key),
      String(g.id),
    ]),
  );

async function demoFlowsStep(c: Ctx): Promise<void> {
  const tid = c.tid[DEMO_KEY] ?? "";
  const groups = await groupMap(c, tid);
  const signers =
    groups.get(SIGN_GROUP_DEMO) ?? fail("demo thiếu nhóm nguoi-ky-hd (chạy bước org trước)");
  const defs = demoFlows();
  for (const d of defs) {
    await ensureFlow(
      c,
      tid,
      groups,
      { ...d, stages: withEsign(d.stages, signers) },
      { overwrite: true },
    );
    console.log(`${TAG}: demo — «${d.name}» đã áp dụng`);
  }
  // thứ tự xét: quy trình UAT của ta lên đầu, «Duyệt hợp đồng» (mọi HĐ còn lại) và các quy trình khác sau
  const rows = items(await call(c.hub, "GET", `/tenants/${tid}/company-flows`));
  const mine = defs.map((d) =>
    String(rows.find((r) => r.name === d.name)?.id ?? fail(`thiếu «${d.name}»`)),
  );
  const order = flowOrder(
    rows.map((r) => String(r.id)),
    mine,
  );
  await call(c.hub, "PUT", `/tenants/${tid}/company-flows/order`, { ids: order });
}

async function evoluFlowStep(c: Ctx, groups: Map<string, string>): Promise<void> {
  const tid = c.tid[EVOLU_KEY] ?? "";
  const [owner] = await c.sql<
    { id: string }[]
  >`select id::text from admin.users where tenant_id = ${tid}::uuid and username = ${RECEIVE.owner}`;
  const def = receiveFlow(owner?.id ?? fail("thiếu người phụ trách UAT ở evolu"));
  const signers = groups.get("uat-nhan-ky") ?? fail("thiếu nhóm uat-nhan-ky");
  const { created } = await ensureFlow(
    c,
    tid,
    groups,
    { ...def, stages: withEsign(def.stages, signers) },
    { overwrite: false },
  );
  console.log(
    `${TAG}: evolu — «${def.name}» ${created ? "đã tạo" : "đã có (giữ nguyên, không ghi đè)"}`,
  );
  // CẢNH BÁO nếu evolu có quy trình Nhận HĐ khác đang bật xét trước (ta không đụng thứ tự của evolu)
  const rows = items(await call(c.hub, "GET", `/tenants/${tid}/company-flows`));
  const first = rows.find((r) => r.trigger_event === "contract.received" && r.enabled === true);
  if (first && first.name !== def.name)
    console.warn(
      `${TAG}: CẢNH BÁO evolu có quy trình Nhận HĐ «${String(first.name)}» đứng trước — HĐ nhận sẽ đi theo quy trình đó; đưa «${def.name}» lên đầu ở trang Quy trình nếu muốn dùng ngưỡng UAT`,
    );
}

/** Dòng đối tác evolu trong sổ đối tác của demo (nguồn danh sách «Chọn đối tác»); người thêm ≠ người chọn (G3). */
async function partnerRow(c: Ctx): Promise<void> {
  const tid = c.tid[DEMO_KEY] ?? "";
  const p = PROFILES[EVOLU_KEY];
  const r =
    await c.sql`insert into contracts.partner_roles (tenant_id, party_key, role, name, created_from, created_by)
    select ${tid}::uuid, ${`tax:${p.tax_code.replace(/\D/g, "")}`}, 'supplier', ${p.legal_name}, 'manual', u.id
    from admin.users u where u.tenant_id = ${tid}::uuid and u.username = ${PARTNER_ADDED_BY}
    on conflict (tenant_id, party_key, role) do nothing returning 1`;
  console.log(`${TAG}: demo — đối tác evolu trong sổ đối tác ${r.length ? "đã thêm" : "đã có"}`);
}

async function main(): Promise<void> {
  const url = env("DATABASE_URL");
  const bad = partnerGuard(process.env, url);
  if (bad) fail(`từ chối — ${bad}`);
  const authUrl = process.env.AUTH_URL || process.env.ADMIN_API_URL || "http://localhost:3001";
  const hubUrl = process.env.HUB_URL || "http://localhost:4000";
  const token = await adminToken(authUrl);
  const api: Api = { base: authUrl, token };
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    const tid: Record<string, string> = {};
    for (const k of [DEMO_KEY, EVOLU_KEY]) {
      const hit = items(await call(api, "GET", `/admin/tenants?q=${k}&limit=50`)).find(
        (t) => t.key === k,
      );
      tid[k] = String(hit?.id ?? fail(`không có công ty ${k}`));
    }
    const c: Ctx = { api, hub: { base: hubUrl, token }, sql, tid };
    await company(c, DEMO_KEY, false);
    await company(c, EVOLU_KEY, true);
    const evoluGroups = await evolu(c);
    await evoluFlowStep(c, evoluGroups);
    await demoFlowsStep(c);
    await partnerRow(c);
    console.log(
      `${TAG} OK — người UAT evolu: ${EVOLU_USERS.map((u) => u.username).join(", ")} (mật khẩu: file UAT_EVOLU.pw)`,
    );
  } finally {
    await sql.end();
  }
}

if (import.meta.main)
  main().catch((e) => {
    console.error(`${TAG} lỗi: ${(e as Error).message}`);
    process.exit(1);
  });
