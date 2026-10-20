// L1 (TECH-DEBT #224) · L1c (review C, depcruise rules-must-be-pure) · adapter băm cho cổng `Hasher` của limit.rules:
// khoá tài khoản Redis = SHA-256 hex của (tenant_key ‖ NUL ‖ username) đã chuẩn hoá.
import { createHash } from "node:crypto";
import { accountIdWith, type Hasher } from "./limit.rules";

export const sha256Hex: Hasher = (input) => createHash("sha256").update(input).digest("hex");

export const accountId = (tenantKey: string, username: string): string =>
  accountIdWith(sha256Hex, tenantKey, username);
