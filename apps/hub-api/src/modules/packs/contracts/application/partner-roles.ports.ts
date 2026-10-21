// V2-C · V2-I · ADR-0023: cổng repo vai đối tác + ghi chú (lớp 2 — chỉ kiểu); `adapters/partner-roles.repo.ts` cài.
import type {
  PartnerContactPerson,
  PartnerContactsPut,
  PartnerContractCount,
  PartnerNote,
  PartnerProfile,
  PartnerRoleV2,
} from "../domain/partner-roles.types";
import type { ProgressRaw } from "./progress";

/** Hàng HĐ thô của đối tác (`contracts`): tóm tắt mốc cho `toProgress` + cột hiển thị. */
export type PartnerContractRaw = ProgressRaw & {
  title: string;
  number: string | null;
  value: number | string | null;
  end_date: string | null;
};

export type RoleCount = {
  party: string;
  role: PartnerRoleV2;
  name: string | null;
  created_from: "contract" | "backfill" | "manual";
  contract_id: string | null;
  first_at: string;
  events: number;
  min_events: number | null;
};
export type PartyHit = { party: string; name: string | null; tax_id: string | null };
export type NoteDelete = { deleted: number; exists: boolean };

export type PartnerRolesRepo = {
  addNote(party: string, body: string, source?: "manual" | "internet"): Promise<PartnerNote | null>;
  deleteNote(id: string, any: boolean): Promise<NoteDelete>;
  contracts(party: string): Promise<PartnerContractRaw[]>;
  contractCounts(): Promise<PartnerContractCount[]>;
  notes(party: string): Promise<PartnerNote[]>;
  profile(party: string): Promise<PartnerProfile | null>;
  setContact(
    party: string,
    phone: string | null,
    contact: string | null,
  ): Promise<{ ok: true } | null>;
  /** GAP-D2 · #24: người liên hệ của đối tác (thứ tự đã lưu). */
  contacts(party: string): Promise<PartnerContactPerson[]>;
  /** Thay cả danh sách (MỘT câu); đối tác ngoài phạm vi ⇒ null. */
  setContacts(
    party: string,
    rows: PartnerContactsPut["contacts"],
  ): Promise<PartnerContactPerson[] | null>;
  roles(party: string | null): Promise<RoleCount[]>;
  find(key: string, fold: string | null): Promise<PartyHit | null>;
};
