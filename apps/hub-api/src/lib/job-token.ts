// HUB-FR-50, WRK-FR-13 · H2a-R18 · P4, RT1 · token job (MCP `/mcp` + credential Q5): Runtime sinh lúc claim
// (`secrets.token_urlsafe(32)`: 43 ký tự base64url không padding), DB chỉ giữ `jobs.token_hash` = sha256 32 byte.
// Hub chỉ băm để tra — không sinh, không lưu, không log bản rõ.
import { createHash } from "node:crypto";

export const JOB_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isJobToken(s: string): boolean {
  return JOB_TOKEN_RE.test(s);
}

/** sha256 của chuỗi token (ASCII; = `hashlib.sha256(token.encode("ascii")).digest()` phía Python). */
export function hashJobToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}
