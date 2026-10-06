import { describe, expect, it } from "bun:test";
import { ApiError } from "#/lib/http";
import { createQueryClient, isForbidden, onForbidden } from "./query-client";

const forbidden = () => new ApiError(403, "FORBIDDEN", "Forbidden");

describe("QueryClient · mất quyền giữa phiên (R01)", () => {
  it("isForbidden chỉ nhận 403 + FORBIDDEN", () => {
    expect(isForbidden(forbidden())).toBe(true);
    expect(isForbidden(new ApiError(403, "SELF_ACTION_FORBIDDEN", "x"))).toBe(false);
    expect(isForbidden(new ApiError(404, "NOT_FOUND", "x"))).toBe(false);
    expect(isForbidden(null)).toBe(false);
  });

  it("query 403 FORBIDDEN ⇒ xoá cache + báo onForbidden", async () => {
    const qc = createQueryClient();
    qc.setQueryData(["other"], 1);
    let hits = 0;
    const off = onForbidden(() => hits++);
    await qc
      .fetchQuery({ queryKey: ["x"], queryFn: () => Promise.reject(forbidden()) })
      .catch(() => {});
    off();
    expect(hits).toBe(1);
    expect(qc.getQueryData(["other"])).toBeUndefined();
  });

  it("mutation 403 FORBIDDEN ⇒ báo onForbidden; lỗi khác thì không", async () => {
    const qc = createQueryClient();
    let hits = 0;
    const off = onForbidden(() => hits++);
    const run = (err: unknown) =>
      qc
        .getMutationCache()
        .build(qc, { mutationFn: () => Promise.reject(err) })
        .execute(undefined)
        .catch(() => {});
    await run(new ApiError(409, "VERSION_CONFLICT", "x"));
    expect(hits).toBe(0);
    await run(forbidden());
    off();
    expect(hits).toBe(1);
  });
});
