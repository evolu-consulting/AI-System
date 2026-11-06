// CR-122 · E5 · FLOW2-FR-25 · node Ký số theo cấu hình riêng (tách khỏi `esign.usecase.ts`, trần 400 dòng): lựa chọn cho panel,
// kiểm cấu hình lúc LƯU def, đổi mục người ký (user/Group) thành user ký. Lớp 2: chỉ cổng.
import {
  ESIGN_NODE_DUE_DAYS_MAX,
  ESIGN_NODE_ORDERS,
  ESIGN_NODE_REMIND_HOURS_MAX,
  ESIGN_NODE_SIGNERS_MAX,
  type ESignNodeCheckOut,
  type ESignNodeOptionsOut,
  type ESignSettingsOut,
  type EsignNodeConfig,
  type EsignNodeSigner,
} from "@ai/contracts/pack-contracts";
import type { PackWho } from "../../kit/public";
import { ESignFail } from "./esign.helpers";

/** Người ký node: `userIds` đã gỡ trùng, theo thứ tự khai (người cụ thể, rồi thành viên Group); `unknown` = mục không thuộc công ty. */
export type NodeDirectory = {
  groups(tenantId: string): Promise<{ id: string; key: string; name: string }[]>;
  resolve(
    tenantId: string,
    entries: readonly EsignNodeSigner[],
  ): Promise<{ userIds: string[]; unknown: EsignNodeSigner[] }>;
};
/** Cấu hình node áp lúc gửi: người ký công ty (user id) + thứ tự. */
export type SendNodeOpts = {
  companyUsers?: readonly string[];
  order?: "parallel" | "sequential";
  /** E5b · hạn ký + chu kỳ nhắc (GIỜ) ghi trên phong bì; `esign-sweep` đọc trước bước Ký số cũ. */
  dueH?: number;
  remindEveryH?: number;
};

type Issues = ESignNodeCheckOut["issues"];
export type EsignNodeDeps = {
  /** Cài đặt ký số hiệu lực của công ty (người gọi) / của tenant (scope hệ thống). */
  settings: (who: PackWho) => Promise<ESignSettingsOut>;
  settingsOf: (tenantId: string) => Promise<ESignSettingsOut>;
  /** Nhà cung cấp khả dụng của khoá (cần FileBox) hoặc null. */
  avail: (key: string) => unknown;
  directory: NodeDirectory | undefined;
};

export function esignNodeApi(d: EsignNodeDeps) {
  const providerIssue = async (tenantId: string, key: string): Promise<Issues> => {
    const s = await d.settingsOf(tenantId);
    if (!s.enabled) return [{ field: "provider", code: "ESIGN_DISABLED" }];
    return d.avail(key) ? [] : [{ field: "provider", code: "PROVIDER_UNAVAILABLE" }];
  };
  const signerIssue = async (
    tenantId: string,
    entries: readonly EsignNodeSigner[],
  ): Promise<Issues> => {
    const r = await d.directory?.resolve(tenantId, entries);
    if (!r) return [{ field: "company_signers", code: "DIRECTORY_UNAVAILABLE" }];
    if (r.unknown.length > 0) return [{ field: "company_signers", code: "SIGNER_NOT_IN_TENANT" }];
    return r.userIds.length === 0 ? [{ field: "company_signers", code: "NO_SIGNER" }] : [];
  };
  return {
    /** Lựa chọn cho panel node: nhà cung cấp ĐANG BẬT + Group (một lượt, không theo hàng). */
    async nodeOptions(who: PackWho): Promise<ESignNodeOptionsOut> {
      const s = await d.settings(who);
      return {
        providers: s.providers
          .filter((p) => p.available)
          .map(({ key, label, kind, legal }) => ({ key, label, kind, legal })),
        default_provider: s.default_provider,
        enabled: s.enabled,
        groups: (await d.directory?.groups(who.tenantId)) ?? [],
        orders: ESIGN_NODE_ORDERS,
        limits: {
          signers_max: ESIGN_NODE_SIGNERS_MAX,
          due_days_max: ESIGN_NODE_DUE_DAYS_MAX,
          remind_hours_max: ESIGN_NODE_REMIND_HOURS_MAX,
        },
      };
    },

    /** Kiểm cấu hình node lúc LƯU def: nhà cung cấp phải đang bật + khả dụng, người ký/Group thuộc công ty (còn dùng được). Lỗi theo khoá trường. */
    async checkNode(tenantId: string, c: EsignNodeConfig): Promise<Issues> {
      const a = c.provider !== undefined ? await providerIssue(tenantId, c.provider) : [];
      const b = c.company_signers?.length ? await signerIssue(tenantId, c.company_signers) : [];
      return [...a, ...b];
    },

    /** Người ký công ty của node: mục `user`/`group` ⇒ danh sách user (thứ tự khai, bỏ trùng, ≤ trần); mục lạ / rỗng ⇒ ném. */
    async resolveNodeSigners(
      tenantId: string,
      entries: readonly EsignNodeSigner[],
    ): Promise<string[]> {
      const r = await d.directory?.resolve(tenantId, entries);
      if (!r || r.unknown.length > 0) throw new ESignFail("ESIGN_SIGNER_NO_EMAIL", "node-signer");
      if (r.userIds.length === 0) throw new ESignFail("ESIGN_SIGNER_NO_EMAIL", "node-signer-empty");
      return r.userIds.slice(0, ESIGN_NODE_SIGNERS_MAX);
    },
  };
}
