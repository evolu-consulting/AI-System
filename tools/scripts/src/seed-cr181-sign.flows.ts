// CR-181/182 · quy trình mẫu của seed ký: «Duyệt và ký hợp đồng (ký trên tài liệu)» (theo VAI, đứng ĐẦU) + quy trình phụ có vai CHƯA giao (đứng CUỐI),
// rồi giao việc cho vai bằng PUT /pack/contracts/approval-flow/roles (quản trị công ty). Không sửa/tắt quy trình nào khác.
import type postgres from "postgres";
import { bindGroupKeys } from "../../../apps/hub-api/src/modules/processes/public";
import {
  roleAssignPlan,
  SIGN_FLOW_NAME,
  SIGN_FLOW2_NAME,
  signFlow2Stages,
  signFlow2Trigger,
  signFlowOrder,
  signFlowStages,
  signFlowTrigger,
} from "./seed-cr181-sign.data";
import { type Call, fail, type Json, must } from "./seed-cr181-sign.http";
import { seedInputs } from "./seed-demo-partner.data";

const TAG = "seed-cr181-sign";
type Def = { name: string; stages: unknown[]; trigger: unknown };
const items = (j: Json): Json[] => (j.items as Json[]) ?? [];

/** Quy trình theo tên (có ⇒ ghi đè bước, không nhân bản) → PUT → Áp dụng. Trả `flow_id`. */
async function ensureFlow(
  hub: Call,
  tid: string,
  groups: Map<string, string>,
  def: Def,
): Promise<string> {
  const base = `/tenants/${tid}/company-flows`;
  let row = items(must(await hub("GET", base), [200], "đọc quy trình")).find(
    (x) => x.name === def.name,
  );
  if (!row) {
    const made = must(
      await hub("POST", base, { name: def.name, app: "contracts", from: "blank" }),
      [200, 201],
      "tạo quy trình",
    );
    row = (made.items as Json[]).find((x) => x.flow_id === made.flow_id);
  }
  const flowId = String(row?.flow_id ?? fail("không thấy quy trình sau khi tạo"));
  const cur = must(await hub("GET", `/process-defs/${flowId}?tenant_id=${tid}`), [200], "đọc def");
  const bound = bindGroupKeys(def.stages, groups, { strip: true });
  if (bound.missing.length) fail(`thiếu nhóm: ${bound.missing.join(", ")}`);
  must(
    await hub("PUT", `/process-defs/${flowId}?tenant_id=${tid}`, {
      key: cur.key,
      name: cur.name,
      description: cur.description ?? "",
      input_hint: cur.input_hint ?? "",
      run_group_ids: cur.run_group_ids ?? [],
      stages: bound.stages,
      token_budget: cur.token_budget ?? null,
      enabled: true,
      sources: cur.sources ?? [],
      inputs: seedInputs(cur.inputs),
      trigger: def.trigger,
      app: "contracts",
      version: cur.version,
    }),
    [200],
    `lưu bước «${def.name}»`,
  );
  must(await hub("POST", `${base}/apply`, { flow_id: flowId }), [200], `áp dụng «${def.name}»`);
  return flowId;
}

/** 2) Hai quy trình + thứ tự (chính ĐẦU, phụ CUỐI) + giao việc cho vai của quy trình chính. */
export async function ensureFlows(
  hub: Call,
  owner: Call,
  sql: ReturnType<typeof postgres>,
  tid: string,
  groups: Map<string, string>,
): Promise<void> {
  const main = await ensureFlow(hub, tid, groups, {
    name: SIGN_FLOW_NAME,
    stages: signFlowStages(),
    trigger: signFlowTrigger(),
  });
  await ensureFlow(hub, tid, groups, {
    name: SIGN_FLOW2_NAME,
    stages: signFlow2Stages(),
    trigger: signFlow2Trigger(),
  });
  const base = `/tenants/${tid}/company-flows`;
  const after = items(must(await hub("GET", base), [200], "đọc lại"));
  const id = (n: string): string =>
    String(after.find((x) => x.name === n)?.id ?? fail(`thiếu «${n}» sau áp dụng`));
  const order = signFlowOrder(
    after.map((x) => String(x.id)),
    id(SIGN_FLOW_NAME),
    id(SIGN_FLOW2_NAME),
  );
  must(await hub("PUT", `${base}/order`, { ids: order }), [200, 204], "đặt thứ tự");
  console.log(`${TAG}: «${SIGN_FLOW_NAME}» đứng đầu, «${SIGN_FLOW2_NAME}» đứng cuối`);

  const users = await sql<{ id: string; username: string }[]>`select id::text as id, username
    from admin.users where tenant_id = ${tid}::uuid`;
  const { assign, missing } = roleAssignPlan(new Map(users.map((u) => [u.username, u.id])));
  if (missing.length)
    fail(`thiếu người dùng để giao vai: ${missing.join(", ")} (chạy --org-only trước)`);
  for (const a of assign)
    must(
      await owner("PUT", "/pack/contracts/approval-flow/roles", { flow_id: main, ...a }),
      [200],
      `giao vai ${a.role_key}`,
    );
  console.log(`${TAG}: đã giao ${assign.length} vai cho «${SIGN_FLOW_NAME}»`);
}
