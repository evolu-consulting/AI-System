// CR-182 · R7 · `POST /pack/contracts/verify-file` (multipart `file`): máy chủ tính sha256 (KHÔNG lưu tệp), so với bản đã ký + tệp gốc cần ký của
// CÔNG TY người gọi, chỉ HĐ người gọi thấy. Không khớp / HĐ không thấy / tenant khác ⇒ cùng một kết quả `{match:false}` (không lộ HĐ).
// Guard `read` TRƯỚC khi đọc thân; cỡ tệp như tải tệp kèm (413 `FILE_TOO_LARGE`); giới hạn tần suất theo người dùng (429).
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AppError, appError } from "../../../../lib/errors";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import { pickMatch, type VerifyCandidate } from "../domain/verify-file.rules";
import type { VerifyFileLimit } from "./verify-file.limit.redis";

const SLACK = 64 * 1024;
const tooLarge = () => new AppError("FILE_TOO_LARGE", 413, "File too large");

export type VerifyFileDeps = {
  maxBytes: number;
  limit: VerifyFileLimit;
  find: (
    who: { tenantId: string; userId: string },
    sha256: string,
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
      return c.json(pickMatch(await d.find(who, sha)));
    },
  );
  return r;
}
