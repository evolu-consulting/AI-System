// trello-config-ui · nghiệp vụ cấu hình Trello (platform_admin). Giá trị key/token chỉ sống trong bộ nhớ tới khi mã hoá xong;
// không bao giờ trả về, log hay ghi audit. Thứ tự dùng khi gửi góp ý: hàng DB (giải mã được) ⇒ env `TRELLO_*` như cũ.
import type { TrelloCheckResponse, TrelloConfigSaveRequest, TrelloConfigView } from "@ai/contracts";
import { type Db, type Tx, withScope } from "@ai/db";
import { auditOf, recordAudit } from "../../lib/audit/audit.write";
import type { Actor } from "../../lib/auth-middleware";
import { AppError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import { logger } from "../../lib/logger";
import type { SecretKey } from "../../lib/secret-crypto";
import { checkTrelloList, type FetchFn, type TrelloConfig } from "./feedback.trello";
import * as repo from "./trello-config.repo";
import {
  openTrelloField,
  pickTrello,
  provided,
  sealTrelloField,
  type TrelloField,
  trelloLast4,
  trelloView,
} from "./trello-config.rules";

export type TrelloCtx = {
  db: Db;
  secretKey?: SecretKey;
  /** env `TRELLO_*` (đủ ba biến) — dự phòng khi DB không có cấu hình. */
  trello?: TrelloConfig;
  /** Chỉ để test. */
  trelloFetch?: FetchFn;
};

const PLATFORM = { kind: "platform" } as const;
const ENTITY_NAME = "integration.trello";

/** Thiếu SECRET_MASTER_KEY ⇒ 503 `SECRET_KEY_UNAVAILABLE` (lỗi cấu hình máy chủ, không phải lỗi người dùng). */
function requireKey(ctx: TrelloCtx): SecretKey {
  if (!ctx.secretKey)
    throw new AppError("SECRET_KEY_UNAVAILABLE", 503, "Secret key is not configured");
  return ctx.secretKey;
}

function openRow(k: SecretKey, r: repo.TrelloRow): TrelloConfig {
  const f = (field: TrelloField, ct: Uint8Array, iv: Uint8Array) =>
    openTrelloField(k, field, { ciphertext: ct, iv, keyVersion: r.keyVersion });
  return {
    apiKey: f("api_key", r.apiKeyCt, r.apiKeyIv),
    token: f("token", r.tokenCt, r.tokenIv),
    listId: r.listId,
  };
}

/** Cấu hình hiệu lực + nguồn. Đọc trong scope platform nội bộ (người gửi góp ý là user tenant; RLS bảng chỉ platform). */
export async function effectiveTrello(
  ctx: TrelloCtx,
): Promise<{ cfg: TrelloConfig | undefined; source: "db" | "env" | "none" }> {
  let fromDb: TrelloConfig | undefined;
  if (ctx.secretKey) {
    const k = ctx.secretKey;
    try {
      const row = await withScope(ctx.db, PLATFORM, (tx) => repo.findTrello(tx));
      fromDb = row ? openRow(k, row) : undefined;
    } catch (err) {
      // Không đưa message gốc (có thể chứa dữ liệu) vào log.
      logger.warn("trello-config-unreadable", {
        error: err instanceof Error ? err.name : "unknown",
      });
    }
  }
  const cfg = pickTrello(fromDb, ctx.trello);
  return { cfg, source: fromDb ? "db" : ctx.trello ? "env" : "none" };
}

export async function getTrelloView(ctx: TrelloCtx): Promise<TrelloConfigView> {
  const row = await withScope(ctx.db, PLATFORM, (tx) => repo.findTrello(tx));
  return trelloView(row, ctx.trello);
}

function audit(
  tx: Tx,
  actor: Actor,
  action: "update" | "delete",
  summary: Record<string, unknown>,
) {
  return recordAudit(tx, {
    ...auditOf(action, "config", {
      entityId: null,
      entityName: ENTITY_NAME,
      tenantId: null,
      before: null,
      after: null,
      summary: { integration: "trello", ...summary },
    }),
    actorId: actor.userId,
  });
}

const missing = (field: TrelloField) =>
  validationError([{ path: [field], code: "required", message: "required" }]);

/** Trống/thiếu key hoặc token = giữ nguyên (giải mã rồi mã hoá lại bằng khoá hiện tại, IV mới). Lần đầu bắt buộc cả hai. */
export async function saveTrello(
  ctx: TrelloCtx,
  actor: Actor,
  input: TrelloConfigSaveRequest,
): Promise<TrelloConfigView> {
  const k = requireKey(ctx);
  const apiKey = provided(input.api_key);
  const token = provided(input.token);
  const row = await withScope(ctx.db, PLATFORM, async (tx) => {
    const cur = await repo.findTrello(tx, true);
    let old: TrelloConfig | undefined;
    if (cur && (!apiKey || !token)) {
      try {
        old = openRow(k, cur);
      } catch {
        old = undefined; // khoá đã đổi ⇒ phải nhập lại
      }
    }
    const nextKey = apiKey ?? old?.apiKey;
    const nextToken = token ?? old?.token;
    if (!nextKey) throw missing("api_key");
    if (!nextToken) throw missing("token");
    const sk = sealTrelloField(k, "api_key", nextKey);
    const st = sealTrelloField(k, "token", nextToken);
    await repo.upsertTrello(tx, {
      apiKeyCt: sk.ciphertext,
      apiKeyIv: sk.iv,
      apiKeyLast4: trelloLast4(nextKey),
      tokenCt: st.ciphertext,
      tokenIv: st.iv,
      tokenLast4: trelloLast4(nextToken),
      keyVersion: k.version,
      listId: input.list_id,
      actorId: actor.userId,
    });
    const after = await repo.findTrello(tx);
    await audit(tx, actor, "update", {
      api_key_changed: !!apiKey,
      token_changed: !!token,
      list_id_changed: cur?.listId !== input.list_id,
    });
    return after;
  });
  return trelloView(row, ctx.trello);
}

/** Xoá cấu hình DB ⇒ về env. Không có hàng ⇒ vẫn 204, không audit. */
export async function clearTrello(ctx: TrelloCtx, actor: Actor): Promise<void> {
  await withScope(ctx.db, PLATFORM, async (tx) => {
    if (await repo.deleteTrello(tx)) await audit(tx, actor, "delete", { cleared: true });
  });
}

export async function checkTrello(ctx: TrelloCtx): Promise<TrelloCheckResponse> {
  const { cfg, source } = await effectiveTrello(ctx);
  if (!cfg) return { ok: false, source, list_name: null, error: "not_configured" };
  return { ...(await checkTrelloList(cfg, ctx.trelloFetch)), source };
}
