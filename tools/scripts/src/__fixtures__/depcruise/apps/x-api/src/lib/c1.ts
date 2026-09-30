// Fixture cố ý vi phạm T-DEP-7: vòng import c1 ↔ c2.
import { c2 } from "./c2";

export const c1 = (): number => c2() + 1;
