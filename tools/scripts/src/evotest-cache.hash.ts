// tool-evotest-cache · băm sha256 (node:crypto) tách khỏi `evotest-cache.rules.ts` để file luật không import core Node (rules-must-be-pure).
import { createHash } from "node:crypto";

export const sha256 = (s: string | Uint8Array): string =>
  createHash("sha256").update(s).digest("hex");
