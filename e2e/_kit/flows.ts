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
 * Flow Thư viện do platform_admin tạo + XUẤT BẢN qua API thật (E6): `POST /process-defs {trigger, app, stages}` → `POST /:id/publish`.
 * Trả id def. Gán cho công ty: `assignCompanyFlow` (api.ts) hoặc UI.
 * Lỗi sản phẩm #6: API từ chối `after.group_key` ở flow Thư viện (PROCESS_REF_INVALID) ⇒ node Duyệt có phòng ban phải qua `withGroupKeys`.
 */
export async function createLibraryFlow(
  hub: string,
  token: string,
  o: {
    key: string;
    name: string;
    app: string;
    trigger: Json;
    stages: Json[];
    withGroupKeys?: boolean;
  },
): Promise<string> {
  const stripped = o.stages.map((s) => {
    const after = s.after as Json;
    if (!o.withGroupKeys || after.kind !== "review") return s;
    const { group_key: _g, ...rest } = after;
    return { ...s, after: rest };
  });
  const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const made = await fetch(`${hub}/process-defs`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      key: o.key,
      name: o.name,
      description: "",
      input_hint: "",
      run_group_ids: [],
      token_budget: null,
      enabled: true,
      sources: [],
      inputs: [],
      stages: stripped,
      trigger: o.trigger,
      app: o.app,
    }),
  });
  const text = await made.text();
  if (made.status >= 300)
    throw new Error(`tạo flow ${o.key}: ${made.status} ${text.slice(0, 300)}`);
  const def = JSON.parse(text) as { id: string; version: number };
  const pub = await fetch(`${hub}/process-defs/${def.id}/publish`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ version: def.version, note: "e2e" }),
  });
  if (pub.status >= 300)
    throw new Error(`xuất bản flow ${o.key}: ${pub.status} ${(await pub.text()).slice(0, 300)}`);
  if (o.withGroupKeys)
    await withOwner(async (sql) => {
      const st = JSON.stringify(o.stages);
      await sql`update hub.process_defs set stages = ${st}::text::jsonb where id = ${def.id}::uuid`;
      await sql`update hub.process_def_releases set stages = ${st}::text::jsonb where def_id = ${def.id}::uuid`;
    });
  return def.id;
}
