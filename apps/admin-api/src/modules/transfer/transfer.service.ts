// ADM-FR-54 · M4-R14 · AC-A06 · Export cấu hình (plan-cd §3.1, §8.1). Một snapshot `repeatable read, read only`, scope
// platform; không ghi, không audit, không NOTIFY. yaml qua thư viện `yaml` (ADR-0005), khoá sắp, không gập dòng.
import { type Db, type DbScope, readConfigVersion, withScope } from "@ai/db";
import { stringify } from "yaml";
import type { Actor } from "../../lib/auth-middleware";
import type { TestHooks } from "../../lib/test-hooks";
import { countSnapshot, readSnapshot, type SnapshotCounts } from "./transfer.repo";
import { buildExportFile, exportFileName, type TransferType } from "./transfer.rules";

export type TransferCtx = { db: Db; now: () => Date; hooks?: TestHooks };
export type Call = { ctx: TransferCtx; actor: Actor; scope: DbScope };

/** Mọi câu đọc cùng một snapshot; chỉ đọc nên không gặp 40001. */
export const SNAPSHOT_TX = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

export type ExportOut = { configVersion: number; fileName: string; text: string };

export async function exportConfig(c: Call, types: readonly TransferType[]): Promise<ExportOut> {
  const snap = await withScope(
    c.ctx.db,
    c.scope,
    async (tx) => readSnapshot(tx, await readConfigVersion(tx), types),
    SNAPSHOT_TX,
  );
  const file = buildExportFile(snap, types, c.ctx.now());
  return {
    configVersion: snap.configVersion,
    fileName: exportFileName(snap.configVersion),
    text: stringify(file, { sortMapEntries: true, lineWidth: 0 }),
  };
}

export async function exportMeta(
  c: Call,
): Promise<{ config_version: number; counts: SnapshotCounts }> {
  return withScope(
    c.ctx.db,
    c.scope,
    async (tx) => ({
      config_version: await readConfigVersion(tx),
      counts: await countSnapshot(tx),
    }),
    SNAPSHOT_TX,
  );
}
