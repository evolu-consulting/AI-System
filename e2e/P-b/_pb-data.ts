// HUB-FR-120…124 · ADM-FR-68/69 · e2e P-b (test-plan §4.6) · dữ liệu cố định dùng chung cho `_pb-stack.ts` (bun) và
// `_pb-support.ts` (Playwright). KHÔNG import `@playwright/test`. Persona: Adm = `binh` (tenant_admin acme) · A = `lan` (member
// acme, người chạy `!key`) · platform_admin = tài khoản seed (đăng nhập tenant `platform`).
import { TENANT_ID, USER_ID } from "../../tests/acceptance/M1/_data";
import { PA_E2E } from "../P-a/_pa-data";

export const ACME = TENANT_ID.acme;
export const PERSONA = {
  A: { id: USER_ID.lan, username: "lan", name: "Lan Tran" },
  Adm: { id: USER_ID.binh, username: "binh", name: "Binh Le" },
} as const;
export type Who = keyof typeof PERSONA;

/** Agent stage (stack dựng, cùng id với P-a). */
export const AGENT = { read: PA_E2E.agentRead, post: PA_E2E.agentPost } as const;

/** Nguồn dựng sẵn qua API Hub (idempotent — `_pb-support.seedPb`). `bad-*` ⇒ Runtime giả báo SOURCE_UNRESOLVABLE. */
export const SRC = {
  app: {
    key: "app-repo",
    url: "https://github.com/pb-test/app-repo.git",
    branch: "main",
    description: "Mã nguồn ứng dụng PB",
  },
  used: {
    key: "used-repo",
    url: "https://github.com/pb-test/used-repo.git",
    branch: "main",
    description: "Kho đang được quy trình dùng",
  },
  bad: {
    key: "bad-repo",
    url: "https://github.com/pb-test/bad-repo.git",
    branch: "main",
    description: "Kho không đọc được",
  },
  /** local_path do platform_admin tạo (tenant acme). */
  local: {
    key: "local-seed",
    path: "/srv/pb-roots/seed-docs",
    description: "Tài liệu cục bộ trên máy Runtime",
  },
} as const;

/** Quy trình dựng sẵn qua API Hub (binh). `run_group_ids` rỗng ⇒ ai cũng chạy được. */
export const DEF = {
  /** Chat: có `inputs` (source_ref + text) ⇒ `!pb-run` mở form. */
  run: { key: "pb-run", name: "Kiểm mã nguồn", inputLabel: "Repo + branch", textLabel: "Ghi chú" },
  /** Chat: nguồn `bad-repo` ⇒ `needs_decision source_unresolvable`. */
  bad: { key: "pb-bad", name: "Kiểm kho hỏng" },
  /** Admin: đang dùng `used-repo` ở giai đoạn `s1` (xoá bị chặn). */
  used: { key: "pb-used", name: "Quy trình đang dùng nguồn" },
  /** Admin editor: chưa có nguồn/inputs. */
  edit: { key: "pb-edit", name: "Quy trình soạn nguồn" },
} as const;
