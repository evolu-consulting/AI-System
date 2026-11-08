// CR-125 · cr125-manual-start-ui · phiếu «Tạo yêu cầu»: giá trị ban đầu, kiểm tại chỗ, payload gửi hub, lỗi theo ô và theo mã.
import { describe, expect, test } from "bun:test";
import { fieldErrorsOf, initialValues, startErrorKey, toPayload, validate } from "./request-form";

const fields = [
  { key: "ten_hang", label: "Tên hàng", type: "text", required: true },
  { key: "so_luong", label: "Số lượng", type: "text", required: false },
  { key: "gia", label: "Giá dự kiến", type: "money", required: true },
  { key: "file", label: "File báo giá", type: "attachments", required: false },
] as never[];

describe("request-form", () => {
  test("ô bắt buộc trống ⇒ lỗi theo ô, tiền sai ⇒ money, đủ ⇒ không lỗi", () => {
    const v = initialValues(fields);
    expect(validate(fields, v)).toEqual({ ten_hang: "required", gia: "required" });
    expect(validate(fields, { ...v, ten_hang: "Máy in", gia: "abc" })).toEqual({ gia: "money" });
    expect(validate(fields, { ...v, ten_hang: "Máy in", gia: "1500000" })).toEqual({});
  });

  test("payload: ô trống bỏ, tiền là số, danh sách tệp giữ mảng id", () => {
    const v = { ...initialValues(fields), ten_hang: " Máy in ", gia: "1500000", file: ["u1"] };
    expect(toPayload(fields, v)).toEqual({ ten_hang: "Máy in", gia: 1500000, file: ["u1"] });
  });

  test("422 START_FORM_INVALID ⇒ mã nghiệp vụ theo ô; mã API ⇒ khoá câu nghiệp vụ, mã lạ ⇒ câu chung", () => {
    expect(fieldErrorsOf({ fields: { gia: "invalid_type", x: "unrecognized", y: "zzz" } })).toEqual(
      {
        gia: "required",
        x: "unknown",
        y: "invalid",
      },
    );
    expect(startErrorKey("START_NOT_ALLOWED")).toBe("process.run.startError.START_NOT_ALLOWED");
    expect(startErrorKey("START_FLOW_OFF")).toBe("process.run.startError.START_FLOW_OFF");
    expect(startErrorKey("NETWORK_ERROR")).toBe("contracts.requests.err.generic");
  });
});
