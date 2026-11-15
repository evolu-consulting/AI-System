// CR-146b · dựng quy trình «Nhận HĐ từ đối tác» của công ty trong DB test: `trigger.params` + (tuỳ chọn) bước Ký với «Người ký phía công ty».
import type { Sql } from "@ai/test-kit/db";

export async function receiveFlowFixture(
  o: Sql,
  tenantId: string,
  o2: { signers?: string | null; params?: object; position?: number } = {},
): Promise<string> {
  const stages = o2.signers
    ? [
        {
          key: "ky",
          executor: {
            tool_key: "contracts-esign-send",
            args: {
              provider: { from: "const", value: "upload" },
              company_signers: { from: "const", value: o2.signers },
            },
          },
        },
      ]
    : [{ key: "nhan", executor: { kind: "tool", tool_key: "contracts-noop", args: {} } }];
  const trigger = JSON.stringify({ event: "contract.received", params: o2.params ?? {} });
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, enabled)
    values (${tenantId}, ${`nhan-${tenantId.slice(0, 8)}`}, 'Nhận HĐ', ${JSON.stringify(stages)}::text::jsonb, ${trigger}::text::jsonb, 'contracts', true)
    returning id::text as id`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled, position) values (${tenantId}, ${r?.id as string}, true, ${o2.position ?? 0})`;
  return r?.id as string;
}
