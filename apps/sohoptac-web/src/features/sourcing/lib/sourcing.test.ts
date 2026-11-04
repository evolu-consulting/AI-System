// W1 · "Mua hàng": luật thuần của màn.
import { describe, expect, test } from "bun:test";
import type { SaleLine, SourceRef } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { parseRef, refKey, selectValue, sourcingErrorText } from "./sourcing";

const ref = (id: string, line = 0): SourceRef => ({
  contract_id: id,
  number: "M",
  line,
  supplier: { key: "k", name: "NCC" },
  price: 5,
  unit: "ram",
  current: true,
  status: "active",
  end_date: null,
});
const row = (o: Partial<SaleLine>): SaleLine => ({
  product: "p",
  name: "Giấy",
  code: null,
  unit: "ram",
  qty: 1,
  price: 10,
  contract_id: "s",
  number: "S-1",
  line: 0,
  kind: "contract",
  end_date: null,
  customer: { key: null, name: "Khách" },
  source: null,
  margin: null,
  margin_pct: null,
  profit: null,
  risk: null,
  ...o,
});
const t = (k: string) => k;

describe("ô chọn nguồn", () => {
  test("giá trị chỉ khi người đã chọn; tự chọn ⇒ trống", () => {
    expect(selectValue(row({ source: { ...ref("m", 2), mode: "chosen" } }))).toBe("m#2");
    expect(selectValue(row({ source: { ...ref("m"), mode: "auto" } }))).toBe("");
    expect(selectValue(row({}))).toBe("");
  });
  test("parseRef tìm đúng ứng viên, lạ ⇒ null", () => {
    const c = [ref("a"), ref("b", 1)];
    expect(parseRef("b#1", c)).toBe(c[1] as SourceRef);
    expect(parseRef("", c)).toBeNull();
    expect(refKey({ contract_id: "x", line: 3 })).toBe("x#3");
  });
});

describe("câu lỗi", () => {
  test("mã đã biết / mạng / khác", () => {
    expect(sourcingErrorText(new ApiError(422, "SOURCING_INVALID" as never, "x"), t)).toBe(
      "contracts.sourcing.errors.SOURCING_INVALID",
    );
    expect(sourcingErrorText(new ApiError(0, "NETWORK_ERROR" as never, "x"), t)).toBe(
      "contracts.errors.network",
    );
    expect(sourcingErrorText(new Error("x"), t)).toBe("contracts.errors.unknown");
  });
});
