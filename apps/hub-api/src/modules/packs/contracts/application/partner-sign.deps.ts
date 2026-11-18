// CR-182 · kiểu phụ thuộc của «Đối tác ký qua link» (lớp 2, chỉ kiểu — tách riêng để use case / lưu chữ ký / thư không import vòng nhau).
import type {
  NotifyTxRepos,
  PackSystemUow,
  PackUow,
  PackWho,
  PartnerSignMailer,
} from "../../kit/public";
import type { PartnerSignRepo } from "../adapters/partner-sign.repo";
import type { SignDocRepos } from "./sign-doc.ports";
import type { StampMarkIn } from "./sign-save.usecase";

export type PartnerSignRepos = SignDocRepos & NotifyTxRepos & { partnerSign: PartnerSignRepo };
/** Bộ đếm của bước Ký `ondoc` đang mở (null = không có bước Ký đang mở). */
export type PartnerCounts = { a_done: boolean; b_total: number; b_open: number } | null;

export type PartnerSignDeps = {
  uow: PackUow<PartnerSignRepos> & PackSystemUow<PartnerSignRepos>;
  /** Tx KHÔNG gắn tenant — chỉ để gọi hàm DEFINER theo BĂM token (tìm tenant của link). */
  lookup: <T>(fn: (r: PartnerSignRepo) => Promise<T>) => Promise<T>;
  files: {
    read(org: string, boxId: string, maxBytes: number): Promise<Uint8Array | null>;
    put(
      org: string,
      name: string,
      bytes: Uint8Array,
    ): Promise<{ fileId: string; versionId: string }>;
    remove(org: string, fileId: string): Promise<void>;
  };
  maxBytes: number;
  produce: (i: {
    pdf: Uint8Array;
    marks: readonly StampMarkIn[];
    ink: "blue" | "black";
    kind: "internal";
    who: PackWho;
  }) => Promise<{ bytes: Uint8Array; sha256: string; pages: number }>;
  /** Transport email chung (null ⇒ `HUB_NOTIFY_MODE=off` ⇒ ghi link ra log để kiểm). */
  mailer: () => PartnerSignMailer | null;
  baseUrl: () => string;
  /** Bước Ký `ondoc` đang mở của HĐ: Bên A đủ chưa + số chỗ Bên B (lắp ráp ở `packs.sign-doc.ts`). */
  counts: (tenantId: string, contractId: string) => Promise<PartnerCounts>;
  /** Thả bước chờ `esign.completed` (HĐ «Đã ký»). Không ném. */
  complete: (tenantId: string, contractId: string) => Promise<void>;
  log: {
    warn(m: string, f?: Record<string, unknown>): void;
    info(m: string, f?: Record<string, unknown>): void;
  };
  newId: () => string;
  now: () => Date;
  orgOf: (tenantId: string) => string;
};
