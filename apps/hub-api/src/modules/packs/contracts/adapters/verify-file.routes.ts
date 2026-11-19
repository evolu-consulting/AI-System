// CR-182 · R7 / CR-188 · `POST /pack/contracts/verify-file` (multipart `file`, tuỳ chọn `from_contract_id`): máy chủ tính sha256 (KHÔNG lưu tệp),
// so với MỌI bản đã ký của CÔNG TY người gọi. Khớp HĐ không có quyền xem ⇒ `{match:true, visible:false}` không chi tiết (cùng hình dạng); tenant khác ⇒ không khớp.
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AppError, appError } from "../../../../lib/errors";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import { pickMatch, type VerifyCandidate } from "../domain/verify-file.rules";
import type { VerifyFileLimit } from "./verify-file.limit.redis";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLACK = 64 * 1024;
const tooLarge = () => new AppError("FILE_TOO_LARGE", 413, "File too large");

export type VerifyFileDeps = {
  maxBytes: number;
  limit: VerifyFileLimit;
  find: (
    who: { tenantId: string; userId: string },
    sha256: string,
    fromContractId: string | null,
  ) => Promise<readonly VerifyCandidate[]>;
};

export function verifyFileRoutes(view: PackAccessView, d: VerifyFileDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.post(
    "/verify-file",
    packGuard(view, "contracts", "read"),
    bodyLimit({
      maxSize: d.maxBytes + SLACK,
      onError: () => {
        throw tooLarge();
      },
    }),
    async (c) => {
      const u = c.get("user");
      const who = { tenantId: u.tenantId, userId: u.userId };
      await d.limit(who.tenantId, who.userId);
      const form = await c.req.formData().catch(() => null);
      const file = form?.getAll("file").find((f): f is File => f instanceof Blob);
      if (!file || file.size === 0) throw appError("VALIDATION_ERROR");
      if (file.size > d.maxBytes) throw tooLarge();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sha = createHash("sha256").update(bytes).digest("hex");
      const from = form?.get("from_contract_id");
      const fromId = typeof from === "string" && UUID_RE.test(from) ? from : null;
      return c.json(pickMatch(await d.find(who, sha, fromId), fromId));
    },
  );
  return r;
}
