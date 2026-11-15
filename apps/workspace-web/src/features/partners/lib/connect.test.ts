// CR-161 · lát 7 · luật thuần của kết nối công ty (nhãn, lỗi, ô tìm, lời nhắn).
import { describe, expect, it } from "bun:test";
import { connectErrKey, noteOf, partnerSearchOf, searchReady, statusTone } from "./connect";

describe("tình trạng kết nối", () => {
  it("tone theo từng trạng thái", () => {
    expect(statusTone("connected")).toBe("ok");
    expect(statusTone("pending_out")).toBe("wait");
    expect(statusTone("pending_in")).toBe("wait");
    expect(statusTone("declined")).toBe("error");
    expect(statusTone("none")).toBe("none");
  });
});

describe("ô tìm và lời nhắn", () => {
  it("cần ≥ 3 ký tự sau khi bỏ khoảng trắng", () => {
    expect(searchReady("ab ")).toBe(false);
    expect(searchReady(" abc ")).toBe(true);
  });
  it("lời nhắn rỗng không gửi; quá 500 ký tự bị cắt", () => {
    expect(noteOf(null)).toBeUndefined();
    expect(noteOf("   ")).toBeUndefined();
    expect(noteOf(" chào ")).toBe("chào");
    expect(noteOf("x".repeat(600))?.length).toBe(500);
  });
});

describe("mã lỗi ⇒ câu dễ hiểu", () => {
  it("map mã API", () => {
    expect(connectErrKey("CONNECT_NOT_LISTED")).toBe("notListed");
    expect(connectErrKey("CONNECT_DECLINED")).toBe("declined");
    expect(connectErrKey("CONNECT_NOT_CONNECTED")).toBe("notConnected");
    expect(connectErrKey("PACK_FORBIDDEN")).toBe("forbidden");
    expect(connectErrKey("NOT_FOUND")).toBe("gone");
    expect(connectErrKey("")).toBe("failed");
  });
});

describe("mở trang đối tác", () => {
  it("khoá đối tác theo MST + tenant", () => {
    expect(partnerSearchOf({ tax_code: "0300111222", tenant_id: "t1" })).toEqual({
      party: "tax:0300111222",
      tenant: "t1",
    });
  });
});
