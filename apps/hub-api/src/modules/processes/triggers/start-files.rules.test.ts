// CR-125 · cr125-run-attachments · unit: id tệp trong giá trị phiếu «Tạo yêu cầu» (chỉ ô `attachments`).
import { describe, expect, test } from "bun:test";
import { startFormFileIds } from "./start-files.rules";

const A = "7c1d2b6e-0000-4000-8000-0000000000aa";
const B = "7c1d2b6e-0000-4000-8000-0000000000bb";
const cfg = {
  fields: [
    { key: "tep", label: "Tệp", type: "attachments", required: false },
    { key: "nguoi", label: "Người", type: "people", required: false },
    { key: "ten", label: "Tên", type: "text", required: false },
  ],
} as never;

describe("CR-125 · startFormFileIds", () => {
  test("chỉ lấy ô attachments; ô người / chữ chứa uuid không bị coi là tệp", () => {
    expect(
      startFormFileIds(cfg, {
        tep: [A, B],
        nguoi: ["7c1d2b6e-0000-4000-8000-0000000000cc"],
        ten: A,
      }),
    ).toEqual([A, B]);
  });
  test("vắng / null ⇒ rỗng", () => {
    expect(startFormFileIds(cfg, { tep: null })).toEqual([]);
    expect(startFormFileIds(cfg, {})).toEqual([]);
  });
});
