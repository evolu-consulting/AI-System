// CR-121 f16 · bản thư viện hay bản riêng; lý do không vẽ được bước.
import { describe, expect, it } from "bun:test";
import { defView, stepsGap } from "./def-kind";

describe("CR-121 f16 · defView", () => {
  it("bản thư viện (chưa có bản sao) ⇒ chỉ xem; có bản sao ⇒ thêm nút mở bản riêng", () => {
    expect(defView({ defId: "L", library: { company_copy: null }, libraryPending: false })).toEqual(
      { kind: "library", copyId: null, libraryId: "L" },
    );
    expect(
      defView({ defId: "L", library: { company_copy: { def_id: "C" } }, libraryPending: false }),
    ).toEqual({ kind: "library", copyId: "C", libraryId: "L" });
  });
  it("không phải bản thư viện (đọc xong, không có dữ liệu thư viện) ⇒ bản riêng mở được, bất kể mã lỗi API", () => {
    expect(defView({ defId: "C", library: undefined, libraryPending: false })).toEqual({
      kind: "own",
      copyId: "C",
      libraryId: null,
    });
  });
  it("đang tải hoặc chưa có quy trình ⇒ chưa quyết, không có nút", () => {
    expect(defView({ defId: "X", library: undefined, libraryPending: true }).kind).toBe("loading");
    expect(defView({ defId: null, library: undefined, libraryPending: false }).copyId).toBeNull();
  });
});

describe("CR-121 f16 · stepsGap", () => {
  it("lỗi tải ⇒ loadFail; đọc xong mà không có bước tuần tự ⇒ noBody; có bước ⇒ không có khoảng trống", () => {
    expect(stepsGap({ error: new Error("x"), loaded: false, hasSteps: false })).toBe("loadFail");
    expect(stepsGap({ error: null, loaded: true, hasSteps: false })).toBe("noBody");
    expect(stepsGap({ error: null, loaded: true, hasSteps: true })).toBeNull();
    expect(stepsGap({ error: null, loaded: false, hasSteps: false })).toBeNull();
  });
});
