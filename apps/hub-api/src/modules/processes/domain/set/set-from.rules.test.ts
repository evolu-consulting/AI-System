// CR-122 · E4 · node Ghi giá trị: nguồn field bước trước / dữ kiện, biến đổi kiểu, sai dạng ⇒ null + bad, luật lưu nguồn field.
import { describe, expect, it } from "bun:test";
import { convertAs, type SetExec, setDefIssues, setFieldsOf } from "./set.rules";

describe("convertAs", () => {
  it("number / text / date / bool, sai dạng ⇒ undefined", () => {
    expect(convertAs("150000000", "number")).toBe(150_000_000);
    expect(convertAs("abc", "number")).toBeUndefined();
    expect(convertAs(["KT", "PC"], "text")).toBe("KT, PC");
    expect(convertAs("2026-11-06T10:00:00Z", "date")).toBe("2026-11-06");
    expect(convertAs("2026-02-30", "date")).toBeUndefined();
    expect(convertAs(true, "bool")).toBe("true");
    expect(convertAs("0", "bool")).toBe("false");
    expect(convertAs("maybe", "bool")).toBeUndefined();
    expect(convertAs(null, "text")).toBeUndefined();
  });
});

describe("setFieldsOf", () => {
  const exec: SetExec = {
    kind: "set",
    values: [
      { key: "amount", from: { kind: "field", step: 0, key: "value" }, as: "number" },
      { key: "kind", from: { kind: "fact", key: "contract_kind" } },
      { key: "bad_date", from: { kind: "fact", key: "signed_at" }, as: "date" },
      { key: "missing", from: { kind: "field", step: 0, key: "nope" } },
      { key: "unit", from: { const: "VND" } },
    ],
  };
  it("map contract.value → amount; dữ kiện; sai dạng / vắng ⇒ null + bad", () => {
    const r = setFieldsOf(exec, {
      inputs: {},
      fieldsByStep: { 0: { value: "150000000" } },
      facts: { contract_kind: "mua_hang", signed_at: "hôm qua" },
    });
    expect(r.fields).toEqual({
      amount: 150_000_000,
      kind: "mua_hang",
      bad_date: null,
      missing: null,
      unit: "VND",
    });
    expect(r.bad).toEqual(["bad_date", "missing"]);
  });
});

describe("setDefIssues · nguồn field", () => {
  const set = (values: SetExec["values"]) => ({
    executor: { kind: "set", values },
    fields: [{ key: "amount", type: "number" }],
  });
  const prev = { executor: { kind: "agent" }, fields: [{ key: "value", type: "number" }] };
  const ctx = { steps: [0, 1] };
  it("bước trước có khoá, kiểu khớp ⇒ hợp lệ", () => {
    expect(
      setDefIssues(
        [prev, set([{ key: "amount", from: { kind: "field", step: 0, key: "value" } }])],
        [],
        ctx,
      ),
    ).toEqual([]);
  });
  it("bước không đứng trước / khoá không có / kiểu sai ⇒ SET_INVALID ở from", () => {
    for (const from of [
      { kind: "field" as const, step: 1, key: "value" },
      { kind: "field" as const, step: 0, key: "nope" },
    ])
      expect(
        setDefIssues([prev, set([{ key: "amount", from }])], [], ctx).map((x) => x.path),
      ).toEqual(["stages.1.executor.values.0.from"]);
    expect(
      setDefIssues(
        [
          prev,
          set([{ key: "amount", from: { kind: "field", step: 0, key: "value" }, as: "text" }]),
        ],
        [],
        ctx,
      ).length,
    ).toBe(1);
  });
  it("không có ngữ cảnh bước ⇒ nguồn field bị chặn; dữ kiện hợp lệ khi `as` khớp", () => {
    expect(
      setDefIssues(
        [prev, set([{ key: "amount", from: { kind: "field", step: 0, key: "value" } }])],
        [],
      ).length,
    ).toBe(1);
    expect(
      setDefIssues(
        [prev, set([{ key: "amount", from: { kind: "fact", key: "v" }, as: "number" }])],
        [],
        ctx,
      ),
    ).toEqual([]);
  });
});
