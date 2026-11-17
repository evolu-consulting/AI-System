// CR-181 · lát s2 · use case chữ ký nội bộ. Mỗi use case = MỘT transaction scope người dùng, số câu SQL CỐ ĐỊNH (không phụ thuộc số hàng).
// Người dùng LUÔN lấy từ JWT (BR-K2): không có tham số user ở tạo/đổi; hàm DB đọc `app.user_id`. Quản trị: kiểm Q15 TRƯỚC khi gọi repo `*AsAdmin`.
// Audit (BR-G3) ghi cùng tx ⇒ lỗi ghi ⇒ rollback. Ảnh KHÔNG vào audit (chỉ id bản cũ/mới).
import type {
  ChangeRequestResponse,
  CreateSignatureBody,
  CreateSignatureResponse,
  GrantChangeResponse,
  MySignatureView,
  SignatureChangeList,
  SignatureSettings,
  SignatureSettingsView,
} from "@ai/contracts/signature";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import { dbHubAudit, type HubAuditWriter } from "../../../lib/hub-audit";
import type { CompanyAdminPort } from "../adapters/company-admin";
import { signaturesRepo } from "../adapters/signatures.repo";
import {
  canChangeNow,
  changeNeedsGrant,
  changeRequestApplies,
  changeStateOf,
  checkPng,
  kindAllowed,
  needsCreate,
} from "../domain/signature.rules";
import type { SignatureRecord, SignatureSettingsRecord } from "../domain/signature.types";

export type SignatureServiceDeps = {
  db: Db;
  admin: CompanyAdminPort;
  audit?: HubAuditWriter;
};

type AuditAction =
  | "signature_created"
  | "signature_settings_changed"
  | "signature_change_requested"
  | "signature_change_granted";
type AuditBody = {
  action: AuditAction;
  entityId: string | null;
  entityName: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  summary?: Record<string, unknown>;
};

const PNG_PREFIX = "data:image/png;base64,";
const scopeOf = (u: AuthUser) => ({
  kind: "user" as const,
  tenantId: u.tenantId,
  userId: u.userId,
});
const deny = (code: string, status: 403 | 404 | 409 | 413 | 415 | 422, msg: string) =>
  new AppError(code, status, msg);
const notAdmin = () => deny("SIGNATURE_FORBIDDEN", 403, "Only company admins can do this");

const itemOf = (r: SignatureRecord) => ({
  id: r.id,
  kind: r.kind,
  method: r.method,
  image: `${PNG_PREFIX}${r.png.toString("base64")}`,
  created_at: r.createdAt,
});

const viewOf = (rec: SignatureSettingsRecord, canEdit: boolean): SignatureSettingsView => ({
  settings: rec.settings,
  stored: rec.stored,
  updated_by: rec.updatedBy,
  updated_at: rec.updatedAt,
  can_edit: canEdit,
});

/** Mã SQLSTATE của lỗi DB (Drizzle bọc lỗi postgres.js ở `cause`). */
function pgCode(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; e && typeof e === "object" && i < 5; i++) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) return c;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

export class SignatureService {
  readonly #audit: HubAuditWriter;
  constructor(private readonly d: SignatureServiceDeps) {
    this.#audit = d.audit ?? dbHubAudit;
  }

  /** Tên hiển thị + username của người thao tác (một câu) — để audit/chuông. */
  async #who(tx: Tx, u: AuthUser): Promise<{ username: string | null; name: string }> {
    const [r] = await tx.execute<{ username: string; name: string }>(
      sql`select username, coalesce(nullif(display_name, ''), username) as name from admin.users
        where id = ${u.userId}::uuid and tenant_id = ${u.tenantId}::uuid`,
    );
    return { username: r?.username ?? null, name: r?.name ?? "" };
  }

  #log(tx: Tx, u: AuthUser, username: string | null, row: AuditBody): Promise<void> {
    return this.#audit.insert(tx, {
      tenantId: u.tenantId,
      actorId: u.userId,
      actorUsername: username,
      actorRole: u.role,
      entity: "signature",
      hubConfigVersion: null,
      summary: {},
      ...row,
    });
  }

  /** `GET /me/signature` — 5 câu SQL (scope, chữ ký đang dùng, thiết lập, lịch sử, trạng thái xin đổi). */
  getMine(u: AuthUser): Promise<MySignatureView> {
    return withHubScope(this.d.db, scopeOf(u), async (tx) => {
      const r = signaturesRepo(tx);
      const active = await r.getActiveAll();
      const { settings } = await r.getSettings();
      const history = await r.listHistory(null, 20);
      const change = changeStateOf(await r.getChangeState());
      const must = needsCreate(settings, active);
      return {
        settings,
        main: active.main && itemOf(active.main),
        initials: active.initials && itemOf(active.initials),
        history: history.map((h) => ({
          id: h.id,
          kind: h.kind,
          method: h.method,
          created_at: h.createdAt,
          retired_at: h.retiredAt,
        })),
        needs_create: must,
        change,
        can_change: canChangeNow(settings, change, must),
        digital: { enabled: false, assigned: false }, // Q12 · đợt 1 luôn khoá
      };
    });
  }

  /** `POST /me/signature` — ≤ 7 câu SQL cố định (kể cả quyền đổi + audit). */
  create(u: AuthUser, body: CreateSignatureBody): Promise<CreateSignatureResponse> {
    const png = Buffer.from(body.png, "base64");
    const chk = checkPng(png);
    if (chk === "too_large") throw deny("SIGNATURE_TOO_LARGE", 413, "Signature image too large");
    if (chk === "not_png") throw deny("SIGNATURE_NOT_PNG", 415, "Signature image must be PNG");
    return withHubScope(this.d.db, scopeOf(u), async (tx) => {
      const r = signaturesRepo(tx);
      const { settings } = await r.getSettings();
      if (!kindAllowed(settings, body.kind))
        throw deny("SIGNATURE_INITIALS_NOT_ALLOWED", 422, "Separate initials are not enabled");
      if (!settings.methods.includes(body.method))
        throw deny("SIGNATURE_METHOD_NOT_ALLOWED", 422, "Creation method not allowed");
      const existing = await r.getActive(body.kind);
      // Lần tạo đầu luôn được; đổi khi policy `admin` ⇒ tiêu MỘT quyền đổi trong CÙNG tx (lỗi sau đó ⇒ rollback ⇒ quyền còn nguyên).
      if (changeNeedsGrant(settings, existing) && !(await r.consumeGrant()))
        throw deny("SIGNATURE_CHANGE_NOT_ALLOWED", 403, "Signature change requires admin approval");
      const made = await r.create(body.kind, body.method, png);
      const who = await this.#who(tx, u);
      await this.#log(tx, u, who.username, {
        action: "signature_created",
        entityId: made.id,
        entityName: body.kind,
        before: { signature_id: made.replacedId },
        after: { signature_id: made.id },
        summary: { kind: body.kind, method: body.method },
      });
      const rec: SignatureRecord = {
        id: made.id,
        kind: body.kind,
        method: body.method,
        png,
        createdAt: made.createdAt,
      };
      return { signature: itemOf(rec), replaced_id: made.replacedId };
    });
  }

  /** `POST /me/signature/change-request` — 1 câu tìm người nhận + ≤ 7 câu trong tx (chuông cùng tx). `created=false` ⇒ không báo lại. */
  async requestChange(u: AuthUser): Promise<{ created: boolean; body: ChangeRequestResponse }> {
    const recipients = await this.d.admin.recipients(u.tenantId, u.userId);
    return withHubScope(this.d.db, scopeOf(u), async (tx) => {
      const r = signaturesRepo(tx);
      const { settings } = await r.getSettings();
      const active = await r.getActiveAll();
      if (!changeRequestApplies(settings, active))
        throw deny("SIGNATURE_CHANGE_NOT_NEEDED", 409, "No admin approval needed");
      const g = await r.requestChange();
      const state: ChangeRequestResponse = {
        change: g.grantedAt === null ? "requested" : "granted",
        requested_at: g.requestedAt,
      };
      if (!g.fresh) return { created: false, body: state };
      const who = await this.#who(tx, u);
      await this.#log(tx, u, who.username, {
        action: "signature_change_requested",
        entityId: g.id,
        entityName: "change-request",
        before: null,
        after: { user_id: u.userId },
      });
      if (recipients.length > 0) {
        const rows = recipients.map((id) => ({
          user_id: id,
          kind: "signature.change_requested",
          title: "Xin đổi chữ ký",
          body: `${who.name} xin đổi chữ ký nội bộ.`.slice(0, 2000),
          link: "/settings/signature",
          dedup_key: `sig-change:${g.id}`,
        }));
        await tx.execute(sql`select notify.enqueue('hub', ${JSON.stringify(rows)}::jsonb)`);
      }
      return { created: true, body: state };
    });
  }

  /** `GET /company/signature-settings` — mọi thành viên (xem trước). 2 câu SQL (+ tra gói từ cache). */
  async getSettings(u: AuthUser): Promise<SignatureSettingsView> {
    const canEdit = await this.d.admin.isAdmin(u);
    const rec = await withHubScope(this.d.db, scopeOf(u), (tx) => signaturesRepo(tx).getSettings());
    return viewOf(rec, canEdit);
  }

  /** `PUT /company/signature-settings` — chỉ quản trị (Q15). 5 câu SQL. */
  async putSettings(u: AuthUser, next: SignatureSettings): Promise<SignatureSettingsView> {
    if (!(await this.d.admin.isAdmin(u))) throw notAdmin();
    return withHubScope(this.d.db, scopeOf(u), async (tx) => {
      const r = signaturesRepo(tx);
      const before = await r.getSettings();
      const after = await r.putSettingsAsAdmin(next);
      const who = await this.#who(tx, u);
      await this.#log(tx, u, who.username, {
        action: "signature_settings_changed",
        entityId: null,
        entityName: "settings",
        before: { ...before.settings, stored: before.stored },
        after: { ...after.settings },
      });
      return viewOf(after, true);
    });
  }

  /** `GET /company/signature-change-requests` — chỉ quản trị. 2 câu SQL. */
  async listRequests(u: AuthUser, limit: number): Promise<SignatureChangeList> {
    if (!(await this.d.admin.isAdmin(u))) throw notAdmin();
    const rows = await withHubScope(this.d.db, scopeOf(u), (tx) =>
      signaturesRepo(tx).listChangeRequestsAsAdmin(limit),
    );
    return {
      items: rows.map((x) => ({
        user_id: x.userId,
        name: x.name,
        requested_at: x.requestedAt,
        granted_at: x.grantedAt,
        granted_by: x.grantedBy,
      })),
    };
  }

  /** `POST /company/signature-change-grants` — chỉ quản trị; không tự cấp cho mình. ≤ 6 câu SQL. `created=false` ⇒ đã cho phép từ trước. */
  async grant(
    u: AuthUser,
    userId: string,
  ): Promise<{ created: boolean; body: GrantChangeResponse }> {
    if (!(await this.d.admin.isAdmin(u))) throw notAdmin();
    return withHubScope(this.d.db, scopeOf(u), async (tx) => {
      const r = signaturesRepo(tx);
      const g = await r.grantChangeAsAdmin(userId).catch((e: unknown) => {
        const code = pgCode(e);
        if (code === "P0002") throw deny("SIGNATURE_USER_NOT_FOUND", 404, "User not found");
        if (code === "42501")
          throw deny("SIGNATURE_SELF_GRANT", 403, "Admins cannot grant themselves");
        throw e;
      });
      if (g.grantedAt === null) throw new Error("sig_change_grant: thiếu granted_at");
      if (g.fresh) {
        const who = await this.#who(tx, u);
        await this.#log(tx, u, who.username, {
          action: "signature_change_granted",
          entityId: g.id,
          entityName: "change-grant",
          before: { user_id: userId, granted: false },
          after: { user_id: userId, granted: true, granted_by: u.userId },
        });
        const row = {
          user_id: userId,
          kind: "signature.change_granted",
          title: "Bạn được đổi chữ ký",
          body: `${who.name} đã cho phép bạn đổi chữ ký nội bộ một lần.`.slice(0, 2000),
          link: "/settings/signature",
          dedup_key: `sig-grant:${g.id}`,
        };
        await tx.execute(sql`select notify.enqueue('hub', ${JSON.stringify([row])}::jsonb)`);
      }
      return { created: g.fresh, body: { user_id: userId, granted_at: g.grantedAt } };
    });
  }
}
