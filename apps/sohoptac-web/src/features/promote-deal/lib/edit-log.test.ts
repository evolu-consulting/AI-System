import { describe, expect, test } from "bun:test";
import { logRows, valueText } from "./edit-log";

describe("edit-log", () => {
  test("valueText: rỗng ⇒ —, số kiểu Việt, đối tượng {value}", () => {
    expect(valueText(null)).toBe("—");
    expect(valueText("")).toBe("—");
    expect(valueText("a")).toBe("a");
    expect(valueText({ value: "x", quote: "" })).toBe("x");
  });
  test("logRows: bỏ tiền tố fields., nhãn biết trước", () => {
    const r = logRows([
      {
        id: "1",
        at: "t",
        actor_user_id: null,
        field: "fields.total_value",
        old_value: "1",
        new_value: "2",
      },
      {
        id: "2",
        at: "t",
        actor_user_id: null,
        field: "fields.zzz",
        old_value: null,
        new_value: "n",
      },
    ]);
    expect(r[0]).toMatchObject({ fieldKey: "total_value", from: "1", to: "2" });
    expect(r[1]).toMatchObject({ fieldKey: null, field: "zzz", from: "—" });
  });
});
