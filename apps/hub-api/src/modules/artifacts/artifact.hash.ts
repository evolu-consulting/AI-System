// CR-114 · băm sha256 (node:crypto) tách khỏi `artifact.rules.ts` để file luật không import core Node (rules-must-be-pure).
import { createHash } from "node:crypto";

/** sha256 hex (64) của nội dung — khoá đầy đủ, chỉ dùng bên trong. */
export const artifactKey = (body: string): string =>
  createHash("sha256").update(body, "utf8").digest("hex");
