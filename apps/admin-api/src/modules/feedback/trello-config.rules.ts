// trello-config-ui · luật thuần cấu hình Trello: thứ tự DB ⇒ env, view che secret, mã hoá theo trường bằng `sealBytes`
// có sẵn (AAD `admin.trello_config:<field>:<key_version>`, tách miền với `admin.secrets:`/`admin.user_totp:`). Không I/O.
import type { TrelloConfigView } from "@ai/contracts";
import { openBytes, type SealedBytes, type SecretKey, sealBytes } from "../../lib/secret-crypto";
import { secretLast4 } from "../secrets/secrets.rules";
import type { TrelloConfig } from "./feedback.trello";

export type TrelloField = "api_key" | "token";
/** Phần hiển thị được của hàng DB (không bản mã). */
export type TrelloRowMeta = {
  apiKeyLast4: string;
  tokenLast4: string;
  listId: string;
  updatedAt: Date;
};

/** Hàng DB (đã giải mã) thắng; không có ⇒ env như cũ. */
export function pickTrello(
  db: TrelloConfig | undefined,
  env: TrelloConfig | undefined,
): TrelloConfig | undefined {
  return db ?? env;
}

const UNSET = { set: false, last4: null } as const;

/** Không bao giờ chứa giá trị secret; env chỉ lộ cờ `env_configured`. */
export function trelloView(
  row: TrelloRowMeta | null,
  env: TrelloConfig | undefined,
): TrelloConfigView {
  if (!row)
    return {
      source: env ? "env" : "none",
      env_configured: !!env,
      api_key: { ...UNSET },
      token: { ...UNSET },
      list_id: null,
      updated_at: null,
    };
  return {
    source: "db",
    env_configured: !!env,
    api_key: { set: true, last4: row.apiKeyLast4 },
    token: { set: true, last4: row.tokenLast4 },
    list_id: row.listId,
    updated_at: row.updatedAt.toISOString(),
  };
}

export function trelloAad(field: TrelloField, keyVersion: number): Uint8Array {
  return new Uint8Array(Buffer.from(`admin.trello_config:${field}:${keyVersion}`, "utf8"));
}

export function sealTrelloField(k: SecretKey, field: TrelloField, value: string): SealedBytes {
  return sealBytes(k, trelloAad(field, k.version), new Uint8Array(Buffer.from(value, "utf8")));
}

/** Sai khoá/trường/tag ⇒ ném (message không chứa dữ liệu). */
export function openTrelloField(k: SecretKey, field: TrelloField, s: SealedBytes): string {
  return Buffer.from(openBytes(k, trelloAad(field, s.keyVersion), s)).toString("utf8");
}

export const trelloLast4 = secretLast4;

/** Chuỗi trống/thiếu ⇒ giữ nguyên. */
export const provided = (v: string | undefined): string | undefined =>
  v !== undefined && v.trim() !== "" ? v.trim() : undefined;
