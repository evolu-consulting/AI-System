// CR-140 · dựng «Quy trình mua hàng» 11 bước (1 cha + 3 con) cho tenant `demo` bằng ĐÚNG đường admin nền tảng (API Hub như màn Quy trình gọi):
//   POST /tenants/:tid/company-flows (sơ đồ trống) → PUT /process-defs/:id (vẽ bước) → POST …/company-flows/apply (Áp dụng cho công ty).
// Con A/B/C trước (cha cần mã quy trình con), rồi cha «Mua hàng». LẶP LẠI ĐƯỢC: quy trình cùng tên ⇒ ghi đè bước + áp dụng lại.
// Từ chối production / DB ngoài localhost; chỉ tenant `demo`. Cần admin-api (:3001) + hub-api (:4000) đang chạy và `bun run demo:org` đã chạy
// (phòng ban + người). `--trial` chạy thử trọn một lượt bằng API (xem seed-purchase-flow.trial.ts).
//   bun run demo:purchase [--trial]   (= bun --env-file=.env.local tools/scripts/src/seed-purchase-flow.ts)
import { parseArgs } from "node:util";
import { bindGroupKeys } from "../../../apps/hub-api/src/modules/processes/public";
import { seedDbHost } from "./seed-community-demo.guard";
import { flowSeedGuard } from "./seed-flow-showcase.build";
import {
  type Call,
  caller,
  env,
  fail,
  type Json,
  login,
  must,
  type Urls,
  urls,
} from "./seed-purchase-flow.api";
import {
  groupKeysOf,
  NAMES,
  NEVER_TRIGGER,
  PARENT_FORM,
  PARENT_INPUTS,
  PURCHASE_FLOWS,
  stagesParent,
} from "./seed-purchase-flow.data";

const TAG = "seed-purchase-flow";
export const TENANT = "demo";

type Ctx = { hub: Call; tid: string; groups: Map<string, string> };

/** Quy trình công ty theo tên (ghi đè nếu có) → PUT bước → Áp dụng. Trả `{flowId, key}`. */
async function ensureFlow(
  c: Ctx,
  name: string,
  stages: unknown[],
  inputs: unknown[],
): Promise<{ flowId: string; key: string }> {
  const base = `/tenants/${c.tid}/company-flows`;
  const list = must(await c.hub("GET", base), [200], "đọc danh sách quy trình");
  let row = (list.items as Json[]).find((x) => x.name === name);
  if (!row) {
    const made = must(
      await c.hub("POST", base, { name, app: "contracts", from: "blank" }),
      [200, 201],
      `tạo «${name}»`,
    );
    row = (made.items as Json[]).find((x) => x.flow_id === made.flow_id);
  }
  const flowId = String(row?.flow_id ?? fail(`không thấy «${name}» sau khi tạo`));
  const def = must(
    await c.hub("GET", `/process-defs/${flowId}?tenant_id=${c.tid}`),
    [200],
    "đọc def",
  );
  const bound = bindGroupKeys(stages, c.groups, { strip: true });
  if (bound.missing.length)
    fail(`công ty demo thiếu nhóm: ${bound.missing.join(", ")} (chạy bun run demo:org trước)`);
  must(
    await c.hub("PUT", `/process-defs/${flowId}?tenant_id=${c.tid}`, {
      key: def.key,
      name: def.name,
      description: def.description ?? "",
      input_hint: def.input_hint ?? "",
      run_group_ids: def.run_group_ids ?? [],
      stages: bound.stages,
      token_budget: def.token_budget ?? null,
      enabled: true,
      sources: def.sources ?? [],
      inputs,
      trigger: NEVER_TRIGGER,
      app: "contracts",
      version: def.version,
    }),
    [200],
    `lưu bước «${name}»`,
  );
  must(await c.hub("POST", `${base}/apply`, { flow_id: flowId }), [200], `áp dụng «${name}»`);
  return { flowId, key: String(def.key) };
}

export async function groupIds(admin: Call, tid: string): Promise<Map<string, string>> {
  const j = must(await admin("GET", `/admin/groups?tenant_id=${tid}&limit=200`), [200], "đọc nhóm");
  return new Map((j.items as Json[]).map((g) => [String(g.key), String(g.id)]));
}

export async function platformCtx(u: Urls): Promise<Ctx & { admin: Call }> {
  const tok = await login(
    u.authUrl,
    "platform",
    env("SEED_ADMIN_USERNAME"),
    env("SEED_ADMIN_PASSWORD"),
  );
  const admin = caller(u.authUrl, tok);
  const hub = caller(u.hubUrl, tok);
  const tenants = must(await admin("GET", "/admin/tenants?limit=100"), [200], "đọc công ty");
  const tid = String(
    (tenants.items as Json[]).find((t) => t.key === TENANT)?.id ??
      fail(`không có công ty ${TENANT}`),
  );
  return { hub, admin, tid, groups: await groupIds(admin, tid) };
}

/** Dựng 4 quy trình; trả mã quy trình cha (`flow_key` để bắt đầu bằng phiếu). */
export async function seedPurchase(c: Ctx): Promise<{ parentKey: string; parentId: string }> {
  const keys: string[] = [];
  for (const f of PURCHASE_FLOWS) {
    const r = await ensureFlow(c, f.name, f.stages(), [...f.inputs]);
    keys.push(r.key);
    console.log(`${TAG}: «${f.name}» đã áp dụng`);
  }
  const [a, b, cc] = keys as [string, string, string];
  const stages = stagesParent({ a, b, c: cc });
  const parent = await ensureFlow(c, NAMES.parent, stages, PARENT_INPUTS);
  console.log(`${TAG}: «${NAMES.parent}» đã áp dụng (phiếu ${PARENT_FORM.fields.length} ô)`);
  return { parentKey: parent.key, parentId: parent.flowId };
}

async function main(): Promise<void> {
  const { values: v } = parseArgs({ options: { trial: { type: "boolean" } } });
  const url = process.env.DATABASE_URL ?? "";
  const bad = flowSeedGuard({
    appEnv: process.env.APP_ENV,
    urls: [url],
    iKnowProd: false,
    isLocal: seedDbHost(),
  });
  if (bad) fail(bad);
  const u = urls();
  const c = await platformCtx(u);
  const used = new Set(PURCHASE_FLOWS.flatMap((f) => groupKeysOf(f.stages())));
  const gone = [...used].filter((k) => !c.groups.has(k));
  if (gone.length)
    fail(`công ty demo thiếu nhóm: ${gone.join(", ")} — chạy bun run demo:org trước`);
  const { parentKey } = await seedPurchase(c);
  if (v.trial) {
    const { runTrials } = await import("./seed-purchase-flow.trial");
    await runTrials(u, c.tid, parentKey);
  }
  console.log(`${TAG} OK`);
}

if (import.meta.main)
  main().catch((e) => {
    console.error(`${TAG} lỗi: ${(e as Error).message}`);
    process.exit(1);
  });
