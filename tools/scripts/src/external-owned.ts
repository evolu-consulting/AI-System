// I/O của danh sách test do người khác sở hữu: đọc `tests/external-owned.json` (vắng ⇒ rỗng).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ExternalOwned, parseExternalOwned } from "./external-owned.rules";

export const EXTERNAL_OWNED_FILE = "tests/external-owned.json";

export function loadExternalOwned(root: string): ExternalOwned[] {
  const path = join(root, EXTERNAL_OWNED_FILE);
  return existsSync(path) ? parseExternalOwned(readFileSync(path, "utf8")) : [];
}
