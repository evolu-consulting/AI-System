// CR-159 · lõi của `bun run tenant:flows` — đi ĐÚNG đường màn Quy trình của admin nền tảng (CR-127), không INSERT tay:
//   GET /tenants/:tid/company-flows → (chưa có) POST sơ đồ trống → PUT /process-defs/:id (bước) → POST …/company-flows/apply → PUT …/order.
// Chạy lại an toàn: quy trình cùng TÊN đã có, đã Bật + đã áp dụng và bước/trigger đã đúng ⇒ bỏ qua (không PUT, không đổi version).
// `Call` là cổng HTTP (CLI: fetch tới hub-api; int test: Hono in-process) ⇒ lõi không biết mạng.
import { bindGroupKeys } from "../../../apps/hub-api/src/modules/processes/public";
import type { FlowDef } from "./tenant-flows.data";

// biome-ignore lint/suspicious/noExplicitAny: JSON của API, đọc theo đường dẫn
export type Json = Record<string, any>;
export type Res = { status: number; json: Json };
export type Call = (method: string, path: string, body?: unknown) => Promise<Res>;
export type Action = "created" | "updated" | "unchanged";
export type Report = { name: string; action: Action };

const fail = (msg: string): never => {
  throw new Error(msg);
};
export const must = (r: Res, ok: number[], what: string): Json => {
  if (!ok.includes(r.status)) fail(`${what} → ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
};

/** `want` có nằm trong `have` không: so từng khoá của `want` (server được thêm mặc định); mảng phải cùng độ dài. THUẦN. */
export function covers(have: unknown, want: unknown): boolean {
  if (want === undefined) return true;
  if (Array.isArray(want))
    return (
      Array.isArray(have) && have.length === want.length && want.every((w, i) => covers(have[i], w))
    );
  if (want !== null && typeof want === "object") {
    if (have === null || typeof have !== "object" || Array.isArray(have)) return false;
    return Object.entries(want).every(([k, w]) => covers((have as Json)[k], w));
  }
  return have === want;
}

export type Ctx = { hub: Call; tid: string; groups: ReadonlyMap<string, string> };

/** Dòng đã Bật + áp dụng và bước / trigger / đầu vào đã đúng bản mong muốn. */
async function upToDate(c: Ctx, row: Json, def: FlowDef, stages: unknown[]): Promise<boolean> {
  if (row.enabled !== true || row.rel_version === null) return false;
  const have = must(
    await c.hub("GET", `/process-defs/${row.flow_id}?tenant_id=${c.tid}`),
    [200],
    `đọc «${def.name}»`,
  );
  return (
    covers(have.stages, stages) &&
    covers(have.trigger, def.trigger) &&
    covers(have.inputs ?? [], def.inputs)
  );
}

/** Một quy trình: tạo/cập nhật/bỏ qua. `dryRun` ⇒ chỉ nói sẽ làm gì, không ghi. */
async function ensureOne(c: Ctx, def: FlowDef, dryRun: boolean): Promise<Action> {
  const base = `/tenants/${c.tid}/company-flows`;
  const list = must(await c.hub("GET", base), [200], "đọc danh sách quy trình");
  let row = (list.items as Json[]).find((x) => x.name === def.name);
  const bound = bindGroupKeys(def.stages, new Map(c.groups), { strip: true });
  if (bound.missing.length) fail(`«${def.name}» thiếu nhóm: ${bound.missing.join(", ")}`);
  if (row && (await upToDate(c, row, def, bound.stages))) return "unchanged";
  const action: Action = row ? "updated" : "created";
  if (dryRun) return action;
  if (!row) {
    const made = must(
      await c.hub("POST", base, { name: def.name, app: "contracts", from: "blank" }),
      [200, 201],
      `tạo «${def.name}»`,
    );
    row = (made.items as Json[]).find((x) => x.flow_id === made.flow_id);
  }
  const flowId = String(row?.flow_id ?? fail(`không thấy «${def.name}» sau khi tạo`));
  const cur = must(
    await c.hub("GET", `/process-defs/${flowId}?tenant_id=${c.tid}`),
    [200],
    `đọc def «${def.name}»`,
  );
  must(
    await c.hub("PUT", `/process-defs/${flowId}?tenant_id=${c.tid}`, {
      key: cur.key,
      name: cur.name,
      description: cur.description ?? "",
      input_hint: cur.input_hint ?? "",
      run_group_ids: cur.run_group_ids ?? [],
      stages: bound.stages,
      token_budget: cur.token_budget ?? null,
      enabled: true,
      sources: cur.sources ?? [],
      inputs: def.inputs,
      trigger: def.trigger,
      app: "contracts",
      version: cur.version,
    }),
    [200],
    `lưu bước «${def.name}»`,
  );
  must(await c.hub("POST", `${base}/apply`, { flow_id: flowId }), [200], `áp dụng «${def.name}»`);
  return action;
}

/** Dựng/cập nhật mọi quy trình của công ty; xong tự kiểm: tất cả Bật + đã áp dụng (trừ dry-run). */
export async function applyTenantFlows(
  c: Ctx,
  defs: readonly FlowDef[],
  o: { dryRun: boolean },
): Promise<Report[]> {
  const out: Report[] = [];
  for (const d of defs) out.push({ name: d.name, action: await ensureOne(c, d, o.dryRun) });
  if (o.dryRun) return out;
  const rows = must(await c.hub("GET", `/tenants/${c.tid}/company-flows`), [200], "kiểm")
    .items as Json[];
  for (const d of defs) {
    const r = rows.find((x) => x.name === d.name);
    if (!r?.enabled || r.rel_version === null)
      fail(`«${d.name}» chưa Bật/áp dụng: ${JSON.stringify(r)}`);
  }
  return out;
}
