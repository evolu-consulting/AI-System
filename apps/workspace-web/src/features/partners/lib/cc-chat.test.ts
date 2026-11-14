// CR-161 · lát 8 · luật thuần trò chuyện hai công ty.
import { describe, expect, it } from "bun:test";
import type { CcMessage } from "@ai/contracts/pack-contracts";
import {
  canSend,
  chatErrKey,
  fileProblem,
  flattenPages,
  groupByDay,
  parseCcMsgFrame,
  readTarget,
} from "./cc-chat";

const T = "11111111-1111-4111-8111-111111111111";
const msg = (seq: number, at = "2026-11-10T10:00:00.000Z"): CcMessage => ({
  seq,
  sender_tenant: T,
  sender_name: "Tiên",
  sender_company: "NitiGroup",
  body: `m${seq}`,
  files: [],
  created_at: at,
  mine: false,
});

describe("gộp trang tin", () => {
  it("cũ → mới, bỏ trùng seq (tin mới tới qua stream trùng trang đầu)", () => {
    const pages = [{ items: [msg(5), msg(4)] }, { items: [msg(3), msg(2), msg(4)] }];
    expect(flattenPages(pages).map((m) => m.seq)).toEqual([2, 3, 4, 5]);
  });
  it("nhóm theo ngày giữ thứ tự", () => {
    const g = groupByDay([
      msg(1, "2026-11-10T01:00:00"),
      msg(2, "2026-11-10T02:00:00"),
      msg(3, "2026-11-12T02:00:00"),
    ]);
    expect(g.map((x) => x.items.length)).toEqual([2, 1]);
  });
});

describe("tệp và gửi", () => {
  it("chặn đuôi lạ, tệp rỗng, quá 20 MB", () => {
    expect(fileProblem({ name: "a.exe", size: 5 })).toBe("type");
    expect(fileProblem({ name: "noext", size: 5 })).toBe("type");
    expect(fileProblem({ name: "a.pdf", size: 0 })).toBe("empty");
    expect(fileProblem({ name: "a.pdf", size: 21 * 1024 * 1024 })).toBe("size");
    expect(fileProblem({ name: "a.pdf", size: 1000 })).toBeNull();
  });
  it("gửi khi có chữ hoặc tệp; không gửi khi đang tải tệp", () => {
    expect(canSend("   ", 0, 0)).toBe(false);
    expect(canSend("chào", 0, 0)).toBe(true);
    expect(canSend("", 1, 0)).toBe(true);
    expect(canSend("chào", 1, 1)).toBe(false);
    expect(canSend("x".repeat(4001), 0, 0)).toBe(false);
  });
  it("mã lỗi ⇒ câu dễ hiểu, 413/415 theo HTTP", () => {
    expect(chatErrKey("HTTP_ERROR", 413)).toBe("size");
    expect(chatErrKey("HTTP_ERROR", 415)).toBe("type");
    expect(chatErrKey("MSG_FILE_TYPE")).toBe("type");
    expect(chatErrKey("CONNECT_READ_ONLY", 409)).toBe("readOnly");
    expect(chatErrKey("PACK_FORBIDDEN", 403)).toBe("forbidden");
    expect(chatErrKey("???")).toBe("failed");
  });
});

describe("realtime và đã đọc", () => {
  it("khung cc.msg hợp lệ / hỏng", () => {
    expect(parseCcMsgFrame(JSON.stringify({ tenant_id: T, seq: 3 }))).toEqual({
      tenant_id: T,
      seq: 3,
    });
    expect(parseCcMsgFrame("{bad")).toBeNull();
    expect(parseCcMsgFrame(JSON.stringify({ tenant_id: "x", seq: 3 }))).toBeNull();
  });
  it("chỉ gửi đã đọc khi có tin mới hơn mốc và chưa gửi mốc đó", () => {
    const list = [msg(1), msg(2), msg(3)];
    expect(readTarget(list, 3, 0)).toBeNull();
    expect(readTarget(list, 1, 0)).toBe(3);
    expect(readTarget(list, 1, 3)).toBeNull();
    expect(readTarget([], 0, 0)).toBeNull();
  });
});
