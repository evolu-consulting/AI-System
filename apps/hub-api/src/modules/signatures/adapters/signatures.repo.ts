// CR-181 · lát s1 · SQL chữ ký nội bộ: chỉ GỌI hàm DEFINER `hub.sig_*` / `hub.signature_for_stamp` (hub 0155) trong tx đã đặt scope người dùng
// (`withHubScope`). Người dùng KHÔNG là tham số: hàm đọc `app.tenant_id`/`app.user_id` ⇒ chỉ chữ ký của chính người gọi (BR-K1/K2).
// Mỗi thao tác đúng MỘT câu SQL (hàm gộp theo tập). Quyền quản trị (putSettings, grantChange) kiểm ở API/use case, không ở đây.

import {
  SIGNATURE_SETTINGS_DEFAULT,
  type SignatureKind,
  type SignatureMethod,
  type SignatureSettings,
} from "@ai/contracts/signature";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ChangeGrantResult,
  ChangeGrantState,
  SignatureCreated,
  SignatureHistoryRow,
  SignatureRecord,
  SignatureSettingsRecord,
} from "../domain/signature.types";

type Ts = Date | string;
const iso = (v: Ts): string => new Date(v).toISOString();
const isoOrNull = (v: Ts | null): string | null => (v === null ? null : iso(v));
/** bytea qua tham số hex (không phụ thuộc cách driver mã hoá Buffer). */
const byteaOf = (png: Uint8Array) => sql`decode(${Buffer.from(png).toString("hex")}, 'hex')`;

type SettingsRow = {
  methods: SignatureSettings["methods"];
  required: boolean;
  caption: SignatureSettings["caption"];
  ink: SignatureSettings["ink"];
  initials: SignatureSettings["initials"];
  change_policy: SignatureSettings["change_policy"];
  on_doc_enabled: boolean;
  digital_enabled: boolean;
  digital_provider: string | null;
  updated_by: string | null;
  updated_at: Ts;
};
const settingsOf = (r: SettingsRow): SignatureSettingsRecord => ({
  settings: {
    methods: r.methods,
    required: r.required,
    caption: r.caption,
    ink: r.ink,
    initials: r.initials,
    change_policy: r.change_policy,
    on_doc_enabled: r.on_doc_enabled,
    digital_enabled: r.digital_enabled,
    digital_provider: r.digital_provider,
  },
  stored: true,
  updatedBy: r.updated_by,
  updatedAt: iso(r.updated_at),
});

type SigRow = {
  id: string;
  kind: SignatureKind;
  method: SignatureMethod;
  png: Uint8Array;
  created_at: Ts;
};
const recordOf = (r: SigRow): SignatureRecord => ({
  id: r.id,
  kind: r.kind,
  method: r.method,
  png: Buffer.from(r.png),
  createdAt: iso(r.created_at),
});

type GrantRow = { id: string; requested_at: Ts; granted_at: Ts | null; fresh: boolean };
const grantOf = (r: GrantRow | undefined): ChangeGrantResult => {
  if (!r) throw new Error("sig_change: không trả dòng");
  return {
    id: r.id,
    requestedAt: iso(r.requested_at),
    grantedAt: isoOrNull(r.granted_at),
    fresh: r.fresh,
  };
};

export function signaturesRepo(tx: Tx) {
  return {
    /** Bản đang dùng của tôi theo loại; null nếu chưa có. */
    async getActive(kind: SignatureKind): Promise<SignatureRecord | null> {
      const [r] = await tx.execute<SigRow>(
        sql`select id, kind, method, png, created_at from hub.sig_get_active(${kind})`,
      );
      return r ? recordOf(r) : null;
    },
    /** Cả hai loại đang dùng trong MỘT câu (màn «Chữ ký của tôi»). */
    async getActiveAll(): Promise<{
      main: SignatureRecord | null;
      initials: SignatureRecord | null;
    }> {
      const rows = await tx.execute<SigRow>(
        sql`select id, kind, method, png, created_at from hub.sig_get_active(null::text)`,
      );
      const by = (k: SignatureKind) => {
        const r = rows.find((x) => x.kind === k);
        return r ? recordOf(r) : null;
      };
      return { main: by("main"), initials: by("initials") };
    },
    /** Lịch sử của tôi, mới → cũ, không kèm ảnh (kind=null ⇒ cả hai loại). limit kẹp 1..100 ở DB. */
    async listHistory(kind: SignatureKind | null, limit = 20): Promise<SignatureHistoryRow[]> {
      const rows = await tx.execute<{
        id: string;
        kind: SignatureKind;
        method: SignatureMethod;
        created_at: Ts;
        retired_at: Ts | null;
      }>(
        sql`select id, kind, method, created_at, retired_at from hub.sig_history(${kind}::text, ${limit}::integer)`,
      );
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        method: r.method,
        createdAt: iso(r.created_at),
        retiredAt: isoOrNull(r.retired_at),
      }));
    },
    /** Tạo/đổi: retire bản đang dùng + thêm bản mới trong một lần (BR-K1). Ảnh ≤ SIGNATURE_PNG_MAX_BYTES (DB: 22023). */
    async create(
      kind: SignatureKind,
      method: SignatureMethod,
      png: Uint8Array,
    ): Promise<SignatureCreated> {
      const [r] = await tx.execute<{ id: string; created_at: Ts; replaced_id: string | null }>(
        sql`select id, created_at, replaced_id from hub.sig_create(${kind}::text, ${method}::text, ${byteaOf(png)})`,
      );
      if (!r) throw new Error("sig_create: không trả dòng");
      return { id: r.id, createdAt: iso(r.created_at), replacedId: r.replaced_id };
    },
    /** Thiết lập của công ty; chưa có hàng ⇒ mặc định (`stored=false`). */
    async getSettings(): Promise<SignatureSettingsRecord> {
      const [r] = await tx.execute<SettingsRow>(sql`select * from hub.sig_settings_get()`);
      return r
        ? settingsOf(r)
        : {
            settings: { ...SIGNATURE_SETTINGS_DEFAULT },
            stored: false,
            updatedBy: null,
            updatedAt: null,
          };
    },
    /** Ghi thiết lập (upsert). CHẶN quyền ở API. */
    async putSettings(s: SignatureSettings): Promise<SignatureSettingsRecord> {
      const [r] = await tx.execute<SettingsRow>(
        sql`select * from hub.sig_settings_put(${arr(s.methods)}, ${s.required}::boolean, ${arr(s.caption)}, ${s.ink}::text,
          ${s.initials}::text, ${s.change_policy}::text, ${s.on_doc_enabled}::boolean, ${s.digital_enabled}::boolean,
          ${s.digital_provider}::text)`,
      );
      if (!r) throw new Error("sig_settings_put: không trả dòng");
      return settingsOf(r);
    },
    /** Hàng xin/cho phép đang mở của tôi, null nếu chưa xin. */
    async getChangeState(): Promise<ChangeGrantState | null> {
      const [r] = await tx.execute<{
        id: string;
        requested_at: Ts;
        granted_at: Ts | null;
        granted_by: string | null;
      }>(sql`select id, requested_at, granted_at, granted_by from hub.sig_change_state()`);
      return r
        ? {
            id: r.id,
            requestedAt: iso(r.requested_at),
            grantedAt: isoOrNull(r.granted_at),
            grantedBy: r.granted_by,
          }
        : null;
    },
    /** Tôi xin đổi. `fresh=false` ⇒ đã có yêu cầu mở (không báo chuông lần hai). */
    async requestChange(): Promise<ChangeGrantResult> {
      const [r] = await tx.execute<GrantRow>(
        sql`select id, requested_at, granted_at, fresh from hub.sig_change_request()`,
      );
      return grantOf(r);
    },
    /** Quản trị cho phép `userId` đổi một lần (CHẶN quyền ở API). Người ngoài công ty ⇒ lỗi P0002. */
    async grantChange(userId: string): Promise<ChangeGrantResult> {
      const [r] = await tx.execute<GrantRow>(
        sql`select id, requested_at, granted_at, fresh from hub.sig_change_grant(${userId}::uuid)`,
      );
      return grantOf(r);
    },
    /** Dùng quyền đổi của tôi: true đúng MỘT lần cho mỗi lần được cho phép. */
    async consumeGrant(): Promise<boolean> {
      const [r] = await tx.execute<{ ok: boolean }>(sql`select hub.sig_change_consume() as ok`);
      return r?.ok === true;
    },
    /** Máy chủ in (BR-K3): bản đang dùng của đúng người ký trong ngữ cảnh. Tham số lệch ngữ cảnh ⇒ lỗi 42501. */
    async signatureForStamp(tenantId: string, userId: string, kind: SignatureKind) {
      const [r] = await tx.execute<{
        id: string;
        method: SignatureMethod;
        png: Uint8Array;
        created_at: Ts;
      }>(
        sql`select id, method, png, created_at from hub.signature_for_stamp(${tenantId}::uuid, ${userId}::uuid, ${kind}::text)`,
      );
      return r ? recordOf({ ...r, kind }) : null;
    },
  };
}
export type SignaturesRepo = ReturnType<typeof signaturesRepo>;

/** text[] qua một tham số JSON (không nở thành nhiều tham số). */
function arr(v: readonly string[]) {
  return sql`array(select jsonb_array_elements_text(${JSON.stringify(v)}::text::jsonb))`;
}
