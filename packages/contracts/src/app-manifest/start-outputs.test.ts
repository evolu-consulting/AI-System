// CR-122 · A · đầu ra Bắt đầu khi (bản ghi + dữ kiện) có ở MỌI cạnh; flow "Duyệt HĐ" (G1) không còn báo thiếu contract_id;
// issue có nhãn + tên bước; input lượt từ sự kiện.
import { describe, expect, it } from "bun:test";
import { type EdgeDef, flowEdgeIssues } from "../hub-admin/process-flow-edges";
import { CONTRACTS_MANIFEST } from "./contracts.manifest";
import { defStartOutputs, eventOf, nodesFor, recordInputsOf } from "./index";

const palette = nodesFor([CONTRACTS_MANIFEST], "contracts");
const st = (key: string, step: number, executor: object, extra: object = {}) => ({
  key,
  name: key.toUpperCase(),
  step,
  executor,
  after: { kind: "auto" },
  ...extra,
});
/** G1 · Bắt đầu khi gửi duyệt HĐ → Nếu giá trị > 100tr → Duyệt → Ký số (node app) → Kết thúc. */
const G1 = (withTrigger: boolean) => ({
  ...(withTrigger ? { app: "contracts", trigger: { event: "contract.submitted" } } : {}),
  stages: [
    st("neu", 0, { kind: "if", then_step: 1, else_step: 1 }),
    st(
      "duyet",
      1,
      { kind: "approve", reject_step: null, return_step: null },
      { after: { kind: "review" } },
    ),
    st("gui-ky", 2, { kind: "tool" }, { node: "contracts.esign", name: "Gửi ký số" }),
    st("ket-thuc", 3, { kind: "set" }, { outcome: "approved" }),
  ],
});

describe("CR-122 · A · bản ghi tự nối", () => {
  it("Bắt đầu khi = contract_id (Hợp đồng) + mọi dữ kiện", () => {
    const out = defStartOutputs({ app: "contracts", trigger: { event: "contract.submitted" } });
    expect(out[0]).toEqual({
      key: "contract_id",
      type: "string",
      required: false,
      label: { vi: "Hợp đồng", en: "Contract" },
    });
    expect(out.length).toBe(1 + (eventOf("contracts", "contract.submitted")?.facts.length ?? 0));
  });

  it("flow G1 có app + trigger ⇒ 0 issue (Ký số tự nhận contract_id qua mọi bước)", () => {
    expect(flowEdgeIssues(G1(true) as unknown as EdgeDef, palette)).toEqual([]);
  });

  it("không có trigger ⇒ vẫn báo thiếu, kèm tên bước + nhãn trường", () => {
    const r = flowEdgeIssues(G1(false) as unknown as EdgeDef, palette);
    expect(r[0]).toMatchObject({
      to: "gui-ky",
      to_name: "Gửi ký số",
      missing: ["contract_id"],
      labels: [{ key: "contract_id", vi: "Hợp đồng", en: "Contract" }],
    });
  });

  it("input lượt từ sự kiện: record = ref + dữ kiện đơn, khoá khai rõ thắng, trống bỏ", () => {
    const ev = eventOf("contracts", "contract.submitted");
    const r = recordInputsOf(ev, "c-1", { value: 150_000_000, contract_type: "", x: 1 }, []);
    expect(r[0]).toEqual({ key: "contract_id", type: "text", text: "c-1" });
    expect(r.some((x) => x.key === "x" || x.key === "contract_type")).toBe(false);
    expect(
      recordInputsOf(ev, "c-1", {}, ["contract_id"]).some((x) => x.key === "contract_id"),
    ).toBe(false);
  });
});
