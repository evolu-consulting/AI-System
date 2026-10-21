// niti-import2 · cổng của `--include-extras` (phần còn lại của MỘT tài khoản, nhãn lô riêng). Lớp 2 — chỉ kiểu.
import type { ExtraTable } from "../domain/extras-contracts.rules";
import type { ExportMeta } from "./owner-ports";
import type { FileSink, FileSource, IdentityPort, SourceReader } from "./ports";

type Row = Record<string, unknown>;

/** Trạng thái lô phần còn lại ở đích (theo nhãn) — MỘT câu hub + MỘT câu gói. */
export type ExtrasState = {
  conversation_ids: string[];
  flows: number;
  messages: number;
  /** Đính kèm của lô: id, file FileBox, sha256 đã ghi. */
  attachments: { id: string; file_id: string | null; sha256: string }[];
  notifications: number;
  notifications_unread: number;
  /** Giao nhận email/push của thông báo lô + thông báo lô chưa "đã phát" (fanout_at null) — phải 0. */
  deliveries: number;
  /** Sổ đăng ký `contracts.import_rows` của lô, theo bảng (legacy_records tách theo kind: `legacy_records:<kind>`). */
  contracts: Record<string, number>;
};

export type ExtrasStore = {
  /** Id đính kèm đã có ở đích (không tải lại). */
  attachmentsPresent(tid: string, uid: string, ids: string[]): Promise<Set<string>>;
  /** MỘT tx: hội thoại + flow + tin + đính kèm (bỏ qua hàng đã có). Trả số hàng chèn mỗi bảng. */
  writeConversation(
    tid: string,
    uid: string,
    source: string,
    u: { conv: Row; flow: Row; messages: Row[]; attachments: Row[] },
  ): Promise<Record<string, number>>;
  /** `notify.import_read` (đã đọc, không phát). */
  writeNotifications(tid: string, uid: string, source: string, rows: Row[]): Promise<number>;
  /** MỘT tx: chèn hàng của một bảng gói + ghi sổ đăng ký các hàng THỰC SỰ chèn. */
  writeContracts(tid: string, source: string, table: ExtraTable, rows: Row[]): Promise<number>;
  state(tid: string, uid: string, source: string): Promise<ExtrasState>;
  /** Hoàn tác lô: hội thoại (+ flow/tin/đính kèm), thông báo, hàng gói theo sổ. */
  rollback(tid: string, uid: string, source: string): Promise<Record<string, number>>;
  /** `admin.tenants.settings.chat_history_months` (vắng ⇒ 12) — cửa sổ của my-chat-history. */
  retentionMonths(tid: string): Promise<number>;
};

export type ExtrasOpts = {
  source: string;
  /** Nhãn lô chính (HĐ đã nhập) — nối chứng thư CKS với HĐ bán. */
  linkSource: string;
  apply: boolean;
  batch: number;
  tenantKey: string;
  ownerEmail: string;
  ownerUsername: string;
  /** Org cũ của chủ (chỉ nhập bản ghi org này); vắng ⇒ org duy nhất của các HĐ của chủ. */
  org: string | null;
  /** Org FileBox của đính kèm hub (env `FILEBOX_ORG` của hub). */
  hubFileOrg: string | null;
  meta: ExportMeta | null;
  rollback: boolean;
};

export type ExtrasDeps = {
  reader: SourceReader;
  identity: IdentityPort;
  store: ExtrasStore;
  /** Thư mục `chat_files` của mgmt-app (`<org>/<id>/<tên>`). */
  chatFiles: FileSource | null;
  sink: FileSink | null;
  now: () => number;
  clock: () => Date;
};
