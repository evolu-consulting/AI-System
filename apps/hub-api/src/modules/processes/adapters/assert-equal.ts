// CA-R03/R04 · CONVENTIONS §5 · plan-domain §6: so khớp kiểu domain ↔ contract lúc typecheck
// (`const _t: AssertEqual<A, B> = true` đỏ khi hai kiểu lệch, kể cả một phía là tập con).
export type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
