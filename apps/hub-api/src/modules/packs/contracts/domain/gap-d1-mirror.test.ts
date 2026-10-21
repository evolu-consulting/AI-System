// gap-d1 · ADR-0023: bản sao kiểu DTO mới ở domain khớp `@ai/contracts` (kiểu: lúc typecheck; hằng số: chạy).
import { describe, expect, it } from "bun:test";
import type * as C from "@ai/contracts";
import { QUOTE_MAX_BYTES as C_QUOTE_MAX } from "@ai/contracts";
import type * as PS from "./product-sources.types";
import type * as PD from "./products.types";
import type * as SP from "./supplier-prices.types";
import { QUOTE_MAX_BYTES } from "./supplier-prices.types";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same = <A, B>(ok: Same<A, B>): Same<A, B> => ok;

describe("gap-d1 · bản sao DTO ở domain khớp @ai/contracts", () => {
  it("hằng số", () => {
    expect(QUOTE_MAX_BYTES).toBe(C_QUOTE_MAX);
  });
  it("kiểu (typecheck)", () => {
    const checks = [
      same<PS.ProductSourceCreate, C.ProductSourceCreate>(true),
      same<PS.ProductSourceOut, C.ProductSourceOut>(true),
      same<PS.DependencyRow, C.DependencyRow>(true),
      same<PS.ProductSourcesOut, C.ProductSourcesOut>(true),
      same<PD.ProductLotCreate, C.ProductLotCreate>(true),
      same<PD.ProductLotResultOut, C.ProductLotResultOut>(true),
      same<PD.ProductOut, C.ProductOut>(true),
      same<PD.StockMoveOut, C.StockMoveOut>(true),
      same<SP.QuoteReadOut, C.QuoteReadOut>(true),
    ];
    expect(checks.every(Boolean)).toBe(true);
  });
});
