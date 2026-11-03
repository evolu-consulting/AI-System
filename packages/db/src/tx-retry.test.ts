// CR-116 · cr116-db-reliable · phân loại lỗi tx (luật thuần): khi nào chạy lại, khi nào "không biết đã commit".
import { describe, expect, test } from "bun:test";
import { classifyTxError, connBackoffMs, TX_OUTCOME_UNKNOWN, TxOutcomeError } from "./tx-retry";

const e = (code: string) => Object.assign(new Error(code), { code });

describe("CR-116 · classifyTxError", () => {
  test("40P01/40001 ⇒ serial, kể cả lỗi lúc COMMIT", () => {
    for (const c of ["40P01", "40001"]) {
      expect(classifyTxError(e(c), false)).toBe("serial");
      expect(classifyTxError(e(c), true)).toBe("serial");
    }
  });
  test("mất kết nối trước COMMIT ⇒ conn-retry, lúc/sau COMMIT ⇒ unknown", () => {
    for (const c of ["CONNECTION_CLOSED", "ECONNRESET", "EPIPE", "57P01", "08006", "08003"]) {
      expect(classifyTxError(e(c), false)).toBe("conn-retry");
      expect(classifyTxError(e(c), true)).toBe("unknown");
    }
  });
  test("mã nằm trong `cause` (drizzle bọc lỗi) cũng nhận", () => {
    expect(classifyTxError({ cause: { code: "57P01" } }, false)).toBe("conn-retry");
  });
  test("lỗi khác / không mã ⇒ fatal", () => {
    expect(classifyTxError(e("23505"), false)).toBe("fatal");
    expect(classifyTxError(new TypeError("x"), false)).toBe("fatal");
    expect(classifyTxError(null, true)).toBe("fatal");
  });
  test("TxOutcomeError mang mã TX_OUTCOME_UNKNOWN + lỗi gốc; backoff có trần", () => {
    const err = new TxOutcomeError(e("CONNECTION_CLOSED"));
    expect([err.code, (err.cause as { code: string }).code]).toEqual([
      TX_OUTCOME_UNKNOWN,
      "CONNECTION_CLOSED",
    ]);
    expect(connBackoffMs(1)).toBeGreaterThanOrEqual(20);
    expect(connBackoffMs(2)).toBeLessThanOrEqual(120);
  });
});
