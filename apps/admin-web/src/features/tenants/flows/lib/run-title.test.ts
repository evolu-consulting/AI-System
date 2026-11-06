import { describe, expect, it } from "bun:test";
import { runTitle } from "./run-title";

const t = (k: string, o: { job: string; at: string }) => `${k}|${o.job}|${o.at}`;

describe("runTitle (CR-121 c11b)", () => {
  it("có nhãn bản ghi ⇒ nhãn là dòng chính, tên việc + giờ là dòng phụ", () => {
    expect(
      runTitle(t, { record_label: "HĐ HD-Q1-001 · Thuê kho" }, "Duyệt hợp đồng", "06/11"),
    ).toEqual({
      primary: "HĐ HD-Q1-001 · Thuê kho",
      secondary: "tenants.flows.runTitle|Duyệt hợp đồng|06/11",
    });
  });

  it("null / rỗng / khoảng trắng / vắng ⇒ chỉ tên việc + giờ, không dòng phụ", () => {
    const plain = { primary: "tenants.flows.runTitle|Duyệt hợp đồng|06/11", secondary: null };
    for (const r of [{ record_label: null }, { record_label: "  " }, {}])
      expect(runTitle(t, r, "Duyệt hợp đồng", "06/11")).toEqual(plain);
  });
});
