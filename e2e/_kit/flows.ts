// e2e/_kit · CR-122 · dựng dữ liệu RIÊNG cho e2e flow (FlowDef): cờ `FLOW_TRIGGERS` theo công ty, flow Thư viện đã xuất bản,
// dựng bước (Bắt đầu khi → Nếu → Duyệt → Kết thúc …). Dùng owner SQL của DB test (`withOwner`) — CHỈ cho phần chuẩn bị mà đường
// sản phẩm chưa làm được (xem `docs/specs/cr122-q1-e2e/tasks.md` · Lỗi sản phẩm: Thư viện chưa xuất bản được flow không khe).
// Khoá/tên luôn có hậu tố duy nhất của spec; không sửa/ẩn dữ liệu mẫu dùng chung.
import { withOwner } from "../support/helpers";

type Json = Record<string, unknown>;

/** Bật `FLOW_TRIGGERS` cho công ty `tenantKey` (đường bóng → thật). Trả id công ty. */
export async function enableFlowTriggers(tenantKey: string, on = true): Promise<string> {
  return withOwner(async (sql) => {
    const [t] = await sql<
      { id: string }[]
    >`select id::text from admin.tenants where key = ${tenantKey}`;
    if (!t) throw new Error(`enableFlowTriggers: không thấy công ty "${tenantKey}"`);
    await sql`insert into hub.tenant_flow_settings (tenant_id, flow_triggers) values (${t.id}::uuid, ${on})
      on conflict (tenant_id) do update set flow_triggers = excluded.flow_triggers, updated_at = now()`;
    return t.id;
  });
}

// ── dựng bước (cùng hình `ProcessStageDef`; `normalizeStage` của Hub lo phần còn lại) ───────────────────────────────────────────
const base = (key: string, name: string, step: number) => ({
  key,
  name,
  step,
  instruction: "",
  output: { filename: `${key}.md`, template: "x", required_sections: ["x"], fields: [] },
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 120,
  token_budget: null,
  sources: [],
  must_know: [],
  autofix: null,
});
const auto = { kind: "auto", branch: [] };

/** Node Duyệt độc lập: Group (mã phòng) quyết; Từ chối/Trả lại đi tới bước `reject`/`ret` (null = kết thúc lượt). */
export function approve(
  key: string,
  name: string,
  step: number,
  groupKey: string,
  o: { reject?: number | null; ret?: number | null; next?: number } = {},
): Json {
  return {
    ...base(key, name, step),
    executor: { kind: "approve", reject_step: o.reject ?? null, return_step: o.ret ?? null },
    after: {
      kind: "review",
      group_id: null,
      group_key: groupKey,
      back_to_steps: [],
      remind_every_h: null,
      escalate: null,
      branch: [],
      exclude_starter: false,
    },
    ...(o.next === undefined ? {} : { next_step: o.next }),
  };
}

/** Node Nếu `fact op value`: Đúng → `thenStep`, Sai → `elseStep`. */
export function ifFact(
  key: string,
  name: string,
  step: number,
  cond: { fact: string; op: string; value: number | string | boolean },
  thenStep: number,
  elseStep: number,
): Json {
  return {
    ...base(key, name, step),
    executor: {
      kind: "if",
      when: {
        op: "and",
        conds: [{ from: { kind: "fact", key: cond.fact }, op: cond.op, value: cond.value }],
      },
      then_step: thenStep,
      else_step: elseStep,
    },
    after: auto,
  };
}

/** Node Chờ sự kiện (vd `esign.completed`) — dùng thay Ký số khi stack không có nhà cung cấp ký số. */
export function waitEvent(key: string, name: string, step: number, event: string): Json {
  return {
    ...base(key, name, step),
    executor: { kind: "wait_event", event, timeout_h: 24 },
    after: auto,
  };
}

/** Node Thông báo chuông tới người gửi duyệt. */
export function notifyCreator(key: string, name: string, step: number, title: string): Json {
  return {
    ...base(key, name, step),
    executor: { kind: "notify", to: [{ who: "starter" }], channels: ["bell"], title, body: "" },
    after: auto,
  };
}

/** Node bảng "Ký số" (`contracts.esign`): hai stage (gửi ký + chờ kết quả) cùng `node`; đầu vào bắt buộc `contract_id`. */
export function esignNode(step: number): Json[] {
  return [
    {
      ...base("ky-gui", "Ký số", step),
      executor: { kind: "tool", tool_key: "contracts-esign-send", args: {} },
      real_action: true,
      after: auto,
      node: "contracts.esign",
    },
    {
      ...base("ky-cho", "Chờ ký", step + 1),
      executor: {
        kind: "wait_event",
        event: "esign.completed",
        also_events: ["esign.declined", "esign.voided"],
        timeout_h: 168,
      },
      after: auto,
      node: "contracts.esign",
    },
  ];
}

/**
 * CR-124 · node «Gửi đối tác xác nhận» (`contracts.partner-send`): BA stage cùng `node` (CR-126: «Chọn đối tác & người nhận» (form, người làm) + tool gửi + chờ `partner.*`);
 * cấu hình là args HẰNG của stage tool (cùng schema với panel; `assignee_group` = nhóm làm bước chọn — Hub ghi `after.group_*` của stage form khi lưu).
 * KHÔNG đặt `partner_tax_code`/`partner_email` ở đây: giá trị do người chọn ở bước form (đặt hằng ⇒ thắng form). Trả lại / Từ chối / Hết hạn rẽ tới `goto.*`.
 */
/** Trường của bước «Chọn đối tác & người nhận» — đúng khai báo stage form của node (`partner-send/node.ts`). */
const PARTNER_PICK_FIELDS = [
  {
    key: "partner_tax_code",
    label: "Đối tác",
    type: "select",
    required: true,
    options: [],
    options_from: "company_partners",
  },
  {
    key: "partner_email",
    label: "Email người nhận",
    type: "text",
    required: true,
    max_len: 254,
    format: "email",
  },
];

export function partnerSendNode(
  step: number,
  cfg: Json,
  goto: { returned: number; declined: number; expired: number },
): Json[] {
  const consts = Object.fromEntries(
    Object.entries(cfg).map(([k, v]) => [k, { from: "const", value: v }]),
  );
  return [
    {
      ...base("chon-doi-tac", "Chọn đối tác & người nhận", step),
      executor: { kind: "form", fields: PARTNER_PICK_FIELDS },
      output: {
        filename: "chon-doi-tac.md",
        template: "x",
        required_sections: ["x"],
        fields: [
          { key: "partner_tax_code", type: "string", required: false },
          { key: "partner_email", type: "string", required: false },
        ],
      },
      after: auto,
      node: "contracts.partner-send",
    },
    {
      ...base("gui-doi-tac", "Gửi đối tác xác nhận", step + 1),
      executor: {
        kind: "tool",
        tool_key: "contracts-partner-send",
        args: { contract_id: { from: "input", key: "contract_id" }, ...consts },
      },
      real_action: true,
      after: auto,
      node: "contracts.partner-send",
    },
    {
      ...base("cho-doi-tac", "Chờ đối tác xác nhận", step + 2),
      executor: {
        kind: "wait_event",
        event: "partner.confirmed",
        also_events: ["partner.returned", "partner.declined"],
        timeout_h: 168,
        branches: [
          { on: "partner.returned", goto_step: goto.returned },
          { on: "partner.declined", goto_step: goto.declined },
          { on: "timeout", goto_step: goto.expired },
        ],
      },
      after: auto,
      node: "contracts.partner-send",
    },
  ];
}

/** Phản hồi giả của "Gợi ý cầu nối": node Ghi giá trị `amount ← giá trị HĐ` (stage đầy đủ, `step` do UI đặt lại khi chèn). */
export function bridgeSet(step: number): Json {
  return {
    ...base("cau-noi", "Ghi giá trị", step),
    executor: {
      kind: "set",
      values: [{ key: "amount", from: { kind: "fact", key: "total_value" }, as: "number" }],
    },
    output: {
      filename: "cau-noi.md",
      template: "x",
      required_sections: ["x"],
      fields: [{ key: "amount", type: "number", required: true }],
    },
    after: auto,
  };
}

/** Node Ghi giá trị trống (bước thường, không node bảng ⇒ không có đầu ra khai báo). */
export function plainSet(key: string, name: string, step: number): Json {
  return { ...base(key, name, step), executor: { kind: "set", values: [] }, after: auto };
}

/** Node Kết thúc (`outcome` của sự kiện). */
export function finish(key: string, name: string, step: number, outcome: string): Json {
  return {
    ...base(key, name, step),
    executor: { kind: "set", values: [] },
    after: auto,
    outcome,
  };
}

/**
 * CR-127 Z7 · quy trình CÔNG TY do platform_admin dựng từ SƠ ĐỒ TRỐNG qua API thật (không còn gán mẫu dùng chung): `POST /tenants/:tid/company-flows
 * {name, app, from:"blank"}` → `PUT /process-defs/:id?tenant_id` (bước + «Bắt đầu khi» + đầu vào) → `POST …/company-flows/apply` (như «Áp dụng cho công ty»).
 * Trả id quy trình công ty.
 */
export async function createCompanyFlow(
  hub: string,
  token: string,
  tenantId: string,
  o: {
    name: string;
    app: string;
    event: string;
    /** Điều kiện «Bắt đầu khi» đầy đủ (vd có `when`); vắng ⇒ `{ event }`. */
    trigger?: Json;
    stages: Json[];
    inputs?: Json[];
  },
): Promise<string> {
  const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const call = async (method: string, url: string, body?: unknown): Promise<Json> => {
    const r = await fetch(`${hub}${url}`, {
      method,
      headers: h,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    if (r.status >= 300) throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as Json) : {};
  };
  const made = await call("POST", `/tenants/${tenantId}/company-flows`, {
    name: o.name,
    app: o.app,
    from: "blank",
  });
  const flowId = String(made.flow_id);
  const q = `?tenant_id=${tenantId}`;
  const def = (await call("GET", `/process-defs/${flowId}${q}`)) as Json & { version: number };
  const keep: Json = {};
  for (const k of [
    "key",
    "name",
    "description",
    "input_hint",
    "run_group_ids",
    "token_budget",
    "enabled",
    "sources",
    "ttl_days",
  ])
    if (def[k] !== undefined) keep[k] = def[k];
  await call("PUT", `/process-defs/${flowId}${q}`, {
    ...keep,
    inputs: o.inputs ?? [],
    stages: o.stages,
    trigger: o.trigger ?? { event: o.event },
    app: o.app,
    version: def.version,
  });
  await call("POST", `/tenants/${tenantId}/company-flows/apply`, { flow_id: flowId });
  return flowId;
}
