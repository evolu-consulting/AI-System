// PK-FR-05 · PK-FR-10 · TF4 · trạng thái gói từ `/me` (viewer/editor/owner, chưa bật, không quyền) và phân loại lỗi khung.
import { describe, expect, mock, test } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import { QueryClient } from "@tanstack/react-query";
import { errorKind, loadErrorKey, ME_QUERY_KEY, packView } from "./pack-state";
import { handlePackError } from "./query-errors";

const me = (enabled: boolean, actions: ("read" | "write" | "admin")[]) => ({
  pack: "contracts",
  enabled,
  actions,
});
const apiErr = (status: number, code: string) => new ApiError(status, code as never, "x");

describe("packView", () => {
  test("PK-FR-05 · viewer/editor/owner ⇒ write/owner suy từ actions", () => {
    expect(packView(me(true, ["read"]))).toEqual({ kind: "ok", write: false, owner: false });
    expect(packView(me(true, ["read", "write"]))).toEqual({
      kind: "ok",
      write: true,
      owner: false,
    });
    expect(packView(me(true, ["read", "write", "admin"]))).toEqual({
      kind: "ok",
      write: true,
      owner: true,
    });
  });
  test("PK-AC06 · chưa bật ⇒ disabled (kể cả còn actions); bật mà không read ⇒ forbidden", () => {
    expect(packView(me(false, []))).toEqual({ kind: "disabled" });
    expect(packView(me(false, ["read"]))).toEqual({ kind: "disabled" });
    expect(packView(me(true, []))).toEqual({ kind: "forbidden" });
  });
});

describe("errorKind", () => {
  test("PK-FR-10 · phân loại theo status/code của ApiError", () => {
    expect(errorKind(apiErr(0, "NETWORK_ERROR"))).toBe("network");
    expect(errorKind(apiErr(401, "UNAUTHORIZED"))).toBe("unauthorized");
    expect(errorKind(apiErr(403, "PACK_DISABLED"))).toBe("disabled");
    expect(errorKind(apiErr(403, "PACK_FORBIDDEN"))).toBe("forbidden");
    expect(errorKind(apiErr(409, "CONTRACT_STALE"))).toBe("conflict");
    // 409 nghiệp vụ (thiếu tồn khi xác nhận giao) không bật toast "người khác vừa cập nhật"
    expect(errorKind(apiErr(409, "STOCK_INSUFFICIENT"))).toBe("other");
    expect(errorKind(apiErr(500, "INTERNAL_ERROR"))).toBe("other");
    expect(errorKind(new Error("x"))).toBe("other");
    expect(errorKind(null)).toBe("other");
  });
  test("PK-FR-10 · câu lỗi nạp /me: mạng ⇒ network, còn lại ⇒ unknown", () => {
    expect(loadErrorKey(apiErr(0, "NETWORK_ERROR"))).toBe("contracts.errors.network");
    expect(loadErrorKey(apiErr(500, "INTERNAL_ERROR"))).toBe("contracts.errors.unknown");
  });
});

describe("handlePackError", () => {
  test("PK-FR-05 · 403 PACK_* ⇒ nạp lại /me; 409 ⇒ toast; lỗi khác ⇒ không làm gì", () => {
    const qc = new QueryClient();
    const invalidate = mock(() => Promise.resolve());
    qc.invalidateQueries = invalidate as unknown as QueryClient["invalidateQueries"];
    const conflict = mock(() => {});
    handlePackError(apiErr(403, "PACK_FORBIDDEN"), qc, { conflict });
    handlePackError(apiErr(403, "PACK_DISABLED"), qc, { conflict });
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate.mock.calls[0]).toEqual([{ queryKey: ME_QUERY_KEY }] as never);
    handlePackError(apiErr(409, "CONTRACT_STALE"), qc, { conflict });
    handlePackError(apiErr(500, "INTERNAL_ERROR"), qc, { conflict });
    expect(conflict).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
