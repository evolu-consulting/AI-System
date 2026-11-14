// CR-161 · lát 5 · cổng (port) của use case kết nối: adapter `connect.repo.ts` / `posts.repo.ts` cài, `connect.mount.ts` tiêm. Lớp 2 — chỉ kiểu.
import type {
  CcPost,
  ConnectCompany,
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
  block(from: string): Promise<boolean>;
  disconnect(other: string): Promise<boolean>;
  connected(other: string): Promise<boolean>;
  links(status: string | null, cur: Cursor | null, limit: number): Promise<ConnectLink[]>;
  owners(tenants: readonly string[]): Promise<CcOwner[]>;
  notify(batch: readonly CcBell[]): Promise<number>;
  auditDisconnect(actor: string, other: string): Promise<void>;
}

export interface PostsRepo {
  page(owner: string, cur: Cursor | null, limit: number): Promise<CcPost[]>;
}
