// N5-FR-01…07 · lớp 4: nối mapper + store (adapter) + use case. Hash "không dùng được" (buộc đặt lại, R7): argon2id của 32
// byte CSPRNG, tính MỘT lần mỗi lần chạy rồi huỷ bí mật — không ai biết mật khẩu, verify tốn như user thường.
import { type Db, hashPassword } from "@ai/db";
import { safeErrorFields } from "../../lib/pg-errors";
import { parseExport } from "./adapters/import.mapper";
import { createImportStore } from "./adapters/import.store";
import { type BatchKind, runImport } from "./application/import.usecase";
import { ImportAbort } from "./domain/errors";
import type { ImportReport } from "./domain/import";

export type { ImportReport };
export { ImportAbort };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEFAULT_BATCH = 500;
export const MAX_BATCH = 1000;

export type RunOpts = {
  actorId: string;
  apply: boolean;
  batch?: number;
  onBatch?: (kind: BatchKind, i: number) => void;
};

export async function unusableHash(): Promise<string> {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return hashPassword(Buffer.from(secret).toString("base64"));
}

/** Lỗi ràng buộc (SQLSTATE lớp 23) ⇒ hỏng một lô (R1); còn lại ⇒ null (ném tiếp). */
export function constraintError(err: unknown): string | null {
  const s = safeErrorFields(err).code;
  return s?.startsWith("23") ? s : null;
}

export async function runIdentityImport(db: Db, raw: unknown, o: RunOpts): Promise<ImportReport> {
  const input = parseExport(raw);
  if (!UUID_RE.test(o.actorId)) throw new ImportAbort("ACTOR_INVALID");
  const batch = Math.min(Math.max(Math.trunc(o.batch ?? DEFAULT_BATCH), 1), MAX_BATCH);
  const store = createImportStore({
    db,
    actorId: o.actorId,
    resetHash: o.apply ? await unusableHash() : "",
    newId: () => Bun.randomUUIDv7(),
  });
  return runImport(
    input,
    { actorId: o.actorId, apply: o.apply, batch },
    { store, clock: { now: () => performance.now() }, constraintError, onBatch: o.onBatch },
  );
}
