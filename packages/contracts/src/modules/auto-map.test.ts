// CR-125 · m4 · MOD-FR-12 · unit: tự nối đầu vào (đúng một nguồn ⇒ nối; nhiều/không ⇒ hỏi bằng câu nghiệp vụ).
import { describe, expect, it } from "bun:test";
import type { AppNodeIo } from "../app-manifest/manifest";
import { autoMapInputs, type MapSource } from "./auto-map";
import { ESIGN_NODE } from "./contracts/esign/node";

const start: MapSource = { id: "contract_id", key: "contract_id", type: "string", from: "start" };
const opt = { node: "Ký số" };
const IN = ESIGN_NODE.inputs as readonly AppNodeIo[];

describe("autoMapInputs", () => {
  it("đúng một nguồn ⇒ nối, không hỏi", () => {
    const r = autoMapInputs(IN, [start], opt);
    expect(r.bound).toEqual([{ key: "contract_id", source: "contract_id", from: "start" }]);
    expect(r.ask).toEqual([]);
  });

  it("không có nguồn ⇒ hỏi bằng câu nghiệp vụ kèm cách khắc phục", () => {
    const r = autoMapInputs(IN, [], opt);
    expect(r.bound).toEqual([]);
    expect(r.ask[0]?.reason).toBe("none");
    expect(r.ask[0]?.message).toBe("Bước «Ký số» cần «Hợp đồng» — thêm bước Tải hợp đồng trước.");
  });

  it("nhiều nguồn ⇒ hỏi chọn một, không tự nối", () => {
    const two: MapSource[] = [start, { ...start, id: "s2:contract_id", from: "step" }];
    const r = autoMapInputs(IN, two, opt);
    expect(r.bound).toEqual([]);
    expect(r.ask[0]).toMatchObject({ reason: "many", sources: ["contract_id", "s2:contract_id"] });
    expect(r.ask[0]?.message).toContain("nhiều nguồn");
  });

  it("khác kiểu không tính là nguồn; đầu vào tuỳ chọn không hỏi", () => {
    const opts: AppNodeIo[] = [{ key: "note", type: "string", required: false }];
    expect(autoMapInputs(opts, [], opt)).toEqual({ bound: [], ask: [] });
    const r = autoMapInputs(IN, [{ ...start, type: "number" }], opt);
    expect(r.ask[0]?.reason).toBe("none");
  });

  it("không có nhãn/cách khắc phục ⇒ dùng khoá và câu chung", () => {
    const r = autoMapInputs([{ key: "x", type: "string", required: true }], [], opt);
    expect(r.ask[0]?.message).toBe("Bước «Ký số» cần «x» — thêm bước tạo «x» trước.");
  });
});
