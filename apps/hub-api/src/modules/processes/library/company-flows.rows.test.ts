// CR-126 · unit · toRows: flow bắt đầu bằng phiếu (stage đầu `core.start-form`) không gây/nhận cảnh báo shadow, không hiện sự kiện.
import { describe, expect, it } from "bun:test";
import type { CfRow } from "./company-flows.repo";
import { toRows } from "./company-flows.service";

const base: CfRow = {
  id: "cf",
  flow_id: "f",
  flow_key: "k",
  name: "n",
  app: "contracts",
  def_tenant_id: "t",
  trigger_event: "contract.submitted",
  has_condition: false,
  enabled: true,
  position: 0,
  replaced_by: null,
  off_reason: null,
  src_id: null,
  src_key: null,
  src_name: null,
  src_version: null,
  src_published: null,
  published_version: 1,
  version: 1,
  updated_at: null,
  deletable: false,
  no_group: false,
  is_start_form: false,
};
const r = (o: Partial<CfRow>): CfRow => ({ ...base, ...o });
const warn = (rows: ReturnType<typeof toRows>) => rows.map((x) => x.warnings.length);

describe("toRows · flow phiếu", () => {
  it("flow phiếu không điều kiện đứng trước KHÔNG chặn flow duyệt HĐ sau nó", () => {
    const rows = toRows([r({ id: "a", is_start_form: true }), r({ id: "b", position: 1 })]);
    expect(warn(rows)).toEqual([0, 0]);
    expect(rows[0]?.trigger_event).toBe("");
    expect(rows[1]?.trigger_event).toBe("contract.submitted");
  });

  it("flow phiếu đứng sau flow không điều kiện cũng không nhận cảnh báo shadow", () => {
    const rows = toRows([r({ id: "a" }), r({ id: "b", position: 1, is_start_form: true })]);
    expect(warn(rows)).toEqual([0, 0]);
  });

  it("đối chứng: hai flow sự kiện không điều kiện ⇒ flow sau bị cảnh báo", () => {
    const rows = toRows([r({ id: "a" }), r({ id: "b", position: 1 })]);
    expect(rows[1]?.warnings).toContain("shadowed_by_unconditional");
  });
});
