// CR-122 p17 · khoá đầu vào quy trình/run cho phép `_` (khoá bản ghi của app: `contract_id`); khoá NGUỒN vẫn chỉ `[a-z0-9-]`.
import { describe, expect, test } from "bun:test";
import { ArgSourceSchema } from "./process-tools";
import { InputKeySchema, ProcessInputDefSchema, SourceKeySchema } from "./sources";

describe("CR-122 p17 · khoá đầu vào", () => {
  test("contract_id hợp lệ ở khai input, nguồn tham số tool; khoá nguồn vẫn cấm _", () => {
    expect(InputKeySchema.safeParse("contract_id").success).toBe(true);
    expect(InputKeySchema.safeParse("Contract_Id").success).toBe(false);
    expect(SourceKeySchema.safeParse("contract_id").success).toBe(false);
    expect(
      ProcessInputDefSchema.safeParse({
        key: "contract_id",
        label: "Hợp đồng",
        type: "text",
        required: true,
      }).success,
    ).toBe(true);
    expect(ArgSourceSchema.safeParse({ from: "input", key: "contract_id" }).success).toBe(true);
  });
});
