// CR-161 · lát 5 · cổng (port) của use case kết nối: adapter `connect.repo.ts` cài, `connect.mount.ts` tiêm. Lớp 2 — chỉ kiểu.
import type {
  ConnectCompany,
  ConnectCompanyPage,
  ConnectInviteBy,
  ConnectLink,
  ConnectStatus,
} from "@ai/contracts/pack-contracts";
import type { Cursor } from "../domain/connect.codec";

export type CcOwner = { tenant_id: string; user_id: string };
export type CcBell = {
  tenant_id: string;
  user_id: string;
  kind: string;
  title: string;
  body?: string;
  link: string;
  dedup_key: string;
};

export interface ConnectRepo {
  search(q: string): Promise<ConnectCompany[]>;
  invite(to: string, note: string | null, userId: string, userName: string): Promise<ConnectStatus>;
  accept(from: string): Promise<boolean>;
  /** BR-191-10 · từ chối kèm lý do (chặn có sẵn + ghi lý do). */
  decline(from: string, reason: string | null): Promise<boolean>;
  /** BR-191-10 · thu hồi lời mời đã gửi (chỉ khi còn chờ). */
  withdraw(to: string): Promise<boolean>;
  /** BR-191-11 · người này có được tìm/mời đối tác mới không (theo cài đặt công ty). */
  canInvite(userId: string): Promise<boolean>;
  inviteBy(): Promise<ConnectInviteBy>;
  setInviteBy(by: ConnectInviteBy, actor: string): Promise<void>;
  /** BR-191-9 · trang công ty; null ⇒ không thấy (không kết nối và không đủ điều kiện). */
  company(id: string): Promise<ConnectCompanyPage | null>;
  disconnect(other: string): Promise<boolean>;
  connected(other: string): Promise<boolean>;
  links(status: string | null, cur: Cursor | null, limit: number): Promise<ConnectLink[]>;
  owners(tenants: readonly string[]): Promise<CcOwner[]>;
  notify(batch: readonly CcBell[]): Promise<number>;
  auditDisconnect(actor: string, other: string): Promise<void>;
}
