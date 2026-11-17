// CR-181 · lát s2 · use case chữ ký nội bộ (lớp 2: chỉ phụ thuộc cổng `./ports`, domain, contracts). Mỗi use case = MỘT transaction scope người dùng
// (`store.run`), số câu SQL CỐ ĐỊNH (không phụ thuộc số hàng). Người dùng LUÔN lấy từ JWT (BR-K2): không có tham số user ở tạo/đổi; hàm DB đọc
// `app.user_id`. Quản trị: kiểm Q15 TRƯỚC khi gọi repo `*AsAdmin`. Audit (BR-G3) + chuông ghi cùng tx ⇒ lỗi ⇒ rollback. Ảnh KHÔNG vào audit.
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
import { SignatureError } from "../domain/signature.error";
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
import type { Actor, CompanyAdminPort, SignatureStore } from "./ports";

export type SignatureServiceDeps = { store: SignatureStore; admin: CompanyAdminPort };

const PNG_PREFIX = "data:image/png;base64,";
const notAdmin = () =>
  new SignatureError("SIGNATURE_FORBIDDEN", 403, "Only company admins can do this");

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

export class SignatureService {
  constructor(private readonly d: SignatureServiceDeps) {}

  /** `GET /me/signature` — 5 câu SQL (scope, chữ ký đang dùng, thiết lập, lịch sử, trạng thái xin đổi). */
  getMine(u: Actor): Promise<MySignatureView> {
    return this.d.store.run(u, async ({ repo }) => {
      const active = await repo.getActiveAll();
      const { settings } = await repo.getSettings();
      const history = await repo.listHistory(null, 20);
      const change = changeStateOf(await repo.getChangeState());
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

  /** `POST /me/signature` — ≤ 8 câu SQL cố định (kể cả khoá, quyền đổi, audit). */
  create(u: Actor, body: CreateSignatureBody): Promise<CreateSignatureResponse> {
    const png = Buffer.from(body.png, "base64");
    const chk = checkPng(png);
    if (chk === "too_large")
      throw new SignatureError("SIGNATURE_TOO_LARGE", 413, "Signature image too large");
    if (chk === "not_png")
      throw new SignatureError("SIGNATURE_NOT_PNG", 415, "Signature image must be PNG");
    return this.d.store.run(u, async (tx) => {
      const { repo } = tx;
      const { settings } = await repo.getSettings();
      if (!kindAllowed(settings, body.kind))
        throw new SignatureError(
          "SIGNATURE_INITIALS_NOT_ALLOWED",
          422,
          "Separate initials are not enabled",
        );
      if (!settings.methods.includes(body.method))
        throw new SignatureError(
          "SIGNATURE_METHOD_NOT_ALLOWED",
          422,
          "Creation method not allowed",
        );
      // Policy `admin`: khoá (người, loại) TRƯỚC khi đọc bản đang dùng ⇒ hai lần tạo đồng thời không cùng thấy «lần đầu» (miễn quyền đổi).
      if (settings.change_policy === "admin") await tx.lockSignature(body.kind);
      const existing = await repo.getActive(body.kind);
      // Lần tạo đầu luôn được; đổi khi policy `admin` ⇒ tiêu MỘT quyền đổi trong CÙNG tx (lỗi sau đó ⇒ rollback ⇒ quyền còn nguyên).
      if (changeNeedsGrant(settings, existing) && !(await repo.consumeGrant()))
        throw new SignatureError(
          "SIGNATURE_CHANGE_NOT_ALLOWED",
          403,
          "Signature change requires admin approval",
        );
      const made = await repo.create(body.kind, body.method, png);
      await tx.audit({
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
  async requestChange(u: Actor): Promise<{ created: boolean; body: ChangeRequestResponse }> {
    const recipients = await this.d.admin.recipients(u.tenantId, u.userId);
    return this.d.store.run(u, async (tx) => {
      const { repo } = tx;
      const { settings } = await repo.getSettings();
      const active = await repo.getActiveAll();
      if (!changeRequestApplies(settings, active))
        throw new SignatureError("SIGNATURE_CHANGE_NOT_NEEDED", 409, "No admin approval needed");
      const g = await repo.requestChange();
      const state: ChangeRequestResponse = {
        change: g.grantedAt === null ? "requested" : "granted",
        requested_at: g.requestedAt,
      };
      if (!g.fresh) return { created: false, body: state };
      const who = await tx.who();
      await tx.audit({
        action: "signature_change_requested",
        entityId: g.id,
        entityName: "change-request",
        before: null,
        after: { user_id: u.userId },
      });
      await tx.bell(
        recipients.map((id) => ({
          user_id: id,
          kind: "signature.change_requested",
          title: "Xin đổi chữ ký",
          body: `${who.name} xin đổi chữ ký nội bộ.`.slice(0, 2000),
          link: "/settings/signature",
          dedup_key: `sig-change:${g.id}`,
        })),
      );
      return { created: true, body: state };
    });
  }

  /** `GET /company/signature-settings` — mọi thành viên (xem trước). 2 câu SQL (+ tra gói từ cache). */
  async getSettings(u: Actor): Promise<SignatureSettingsView> {
    const canEdit = await this.d.admin.isAdmin(u);
    const rec = await this.d.store.run(u, ({ repo }) => repo.getSettings());
    return viewOf(rec, canEdit);
  }

  /** `PUT /company/signature-settings` — chỉ quản trị (Q15). 5 câu SQL. */
  async putSettings(u: Actor, next: SignatureSettings): Promise<SignatureSettingsView> {
    if (!(await this.d.admin.isAdmin(u))) throw notAdmin();
    return this.d.store.run(u, async (tx) => {
      const before = await tx.repo.getSettings();
      const after = await tx.repo.putSettingsAsAdmin(next);
      await tx.audit({
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
  async listRequests(u: Actor, limit: number): Promise<SignatureChangeList> {
    if (!(await this.d.admin.isAdmin(u))) throw notAdmin();
    const rows = await this.d.store.run(u, ({ repo }) => repo.listChangeRequestsAsAdmin(limit));
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
  async grant(u: Actor, userId: string): Promise<{ created: boolean; body: GrantChangeResponse }> {
    if (!(await this.d.admin.isAdmin(u))) throw notAdmin();
    return this.d.store.run(u, async (tx) => {
      const g = await tx.repo.grantChangeAsAdmin(userId);
      if (g.grantedAt === null) throw new Error("sig_change_grant: thiếu granted_at");
      if (g.fresh) {
        const who = await tx.who();
        await tx.audit({
          action: "signature_change_granted",
          entityId: g.id,
          entityName: "change-grant",
          before: { user_id: userId, granted: false },
          after: { user_id: userId, granted: true, granted_by: u.userId },
        });
        await tx.bell([
          {
            user_id: userId,
            kind: "signature.change_granted",
            title: "Bạn được đổi chữ ký",
            body: `${who.name} đã cho phép bạn đổi chữ ký nội bộ một lần.`.slice(0, 2000),
            link: "/settings/signature",
            dedup_key: `sig-grant:${g.id}`,
          },
        ]);
      }
      return { created: g.fresh, body: { user_id: userId, granted_at: g.grantedAt } };
    });
  }
}
