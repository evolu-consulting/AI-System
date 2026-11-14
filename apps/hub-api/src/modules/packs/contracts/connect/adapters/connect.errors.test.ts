// CR-161 · lát 5 · ánh xạ lỗi DB ⇒ AppError (spec §3): CC422/CC409/CC404 ⇒ mã contract, 42501 ⇒ 404, 22023 ⇒ 400; lỗi bọc (drizzle `cause`) vẫn nhận ra.
import { describe, expect, it } from "bun:test";
import { AppError } from "../../../../../lib/errors";
import { ccError } from "./connect.errors";

const pg = (code: string, message = "x") => Object.assign(new Error(message), { code });
const wrapped = (code: string, message: string) =>
  Object.assign(new Error("Failed query: select ..."), { cause: pg(code, message) });
const run = (e: unknown, nf?: Parameters<typeof ccError>[1]) => {
  try {
    ccError(e, nf);
  } catch (x) {
    return x;
  }
  return null;
};

describe("CR-161 · ccError", () => {
  it("lỗi nghiệp vụ ⇒ mã + HTTP theo CC_ERRORS (kể cả bọc cause)", () => {
    for (const [c, m, s] of [
      ["CC422", "CONNECT_NOT_LISTED", 422],
      ["CC409", "CONNECT_DECLINED", 409],
      ["CC409", "CONNECT_NOT_CONNECTED", 409],
      ["CC409", "CONNECT_READ_ONLY", 409],
      ["CC404", "CONNECT_NO_THREAD", 404],
      ["CC422", "MSG_EMPTY", 422],
    ] as const) {
      for (const e of [pg(c, m), wrapped(c, m)]) {
        const r = run(e) as AppError;
        expect([r.code, r.status]).toEqual([m, s]);
      }
    }
  });
  it("42501 ⇒ 404 NOT_FOUND (không lộ); có `notFound` ⇒ mã đó", () => {
    expect((run(wrapped("42501", "denied")) as AppError).status).toBe(404);
    expect((run(pg("42501")) as AppError).code).toBe("NOT_FOUND");
    const r = run(pg("42501"), "CONNECT_NOT_CONNECTED") as AppError;
    expect([r.code, r.status]).toEqual(["CONNECT_NOT_CONNECTED", 404]);
  });
  it("22023 ⇒ 400; AppError đi qua nguyên vẹn; lỗi lạ ném lại", () => {
    expect((run(pg("22023")) as AppError).status).toBe(400);
    const a = new AppError("X", 418, "x");
    expect(run(a)).toBe(a);
    const odd = pg("XX000", "boom");
    expect(run(odd)).toBe(odd);
    expect(run(pg("CC409", "UNKNOWN_CODE"))).toBeInstanceOf(Error);
    expect(run(pg("CC409", "UNKNOWN_CODE")) instanceof AppError).toBe(false);
  });
});
