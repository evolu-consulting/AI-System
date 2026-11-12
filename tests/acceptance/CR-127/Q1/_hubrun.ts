// CR-127 · Q1e · dựng thẳng hàng hub (lượt chạy engine của gói contracts + việc duyệt đang mở) cho test người duyệt — engine thật
// không chạy ở đây (phạm vi E10); FK hub bỏ bằng `session_replication_role = replica`. Không chứa `it(...)`.
import { groups, members } from "@ai/test-kit/builders";
import type { CtxN1, Json } from "../../V2-G/_support/v2g";
import { T } from "../../V2-G/_support/v2g";

export async function mkGroup(c: CtxN1, name: string, users: string[]): Promise<string> {
  const g = (await groups(c.sql as never, T.acme, [name])).get(name) as string;
  await members(c.sql as never, T.acme, g, users);
  return g;
}

/** Lượt chạy `waiting_review` của HĐ `contractId` + một việc duyệt `open` giao cho Group `group` (bước 0, `exclude_starter` theo `o`). */
export async function openReviewRun(
  c: CtxN1,
  contractId: string,
  o: { group: string; starter: string; excludeStarter?: boolean; status?: string },
): Promise<{ run: string; task: string }> {
  const run = crypto.randomUUID();
  const sr = crypto.randomUUID();
  const task = crypto.randomUUID();
  const stages = [
    {
      key: "doc",
      name: "Duyệt",
      after: { kind: "review", group_id: o.group, exclude_starter: o.excludeStarter ?? false },
    },
  ];
  const snap = {
    key: "q1e",
    name: "Duyệt HĐ",
    stages,
    token_budget: null,
    run_group_ids: [] as string[],
  };
  await c.sql.begin(async (t) => {
    await t`set local session_replication_role = replica`;
    await t`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
        conversation_id, flow_id, status, current_stage_idx, expires_at, pack_key, pack_record_id)
      values (${run}, ${T.acme}, ${crypto.randomUUID()}, 1, ${t.json(snap as Json)}, ${o.starter}, 'admin', 'x',
        ${crypto.randomUUID()}, ${crypto.randomUUID()}, ${o.status ?? "waiting_review"}, 0, now() + interval '7 days', 'contracts', ${contractId})`;
    await t`insert into hub.stage_runs (id, tenant_id, process_run_id, stage_idx, status)
      values (${sr}, ${T.acme}, ${run}, 0, 'waiting_review')`;
    await t`insert into hub.review_tasks (id, tenant_id, process_run_id, stage_run_id, kind, status, output_id, assignee_group_id)
      values (${task}, ${T.acme}, ${run}, ${sr}, 'review', 'open', ${crypto.randomUUID()}, ${o.group})`;
  });
  return { run, task };
}

/** `reviewer_contract_ids()` dưới RLS thật (`contracts_rw`) như `user` của acme ⇒ HĐ có nằm trong tập không. */
export async function inReviewerSet(c: CtxN1, user: string, id: string): Promise<boolean> {
  return c.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${T.acme}, true), set_config('app.user_id', ${user}, true)`;
    await tx`set local role contracts_rw`;
    const [r] = await tx<
      { ok: boolean }[]
    >`select ${id}::uuid = any(contracts.reviewer_contract_ids()) as ok`;
    return r?.ok === true;
  });
}
