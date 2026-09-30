// Fixture cố ý vi phạm T-DEP-7: vòng import c2 ↔ c1.
import { c1 } from "./c1";

export const c2 = (): number => (typeof c1 === "function" ? 1 : 0);
