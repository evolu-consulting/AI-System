// niti-import · lọc ảnh chụp mgmt-app về đúng MỘT tài khoản (chủ HĐ cũ, theo email): HĐ do người đó phụ trách (hoặc chưa giao mà
// người đó tạo) + phụ lục của các HĐ đó; đợt/sổ của các HĐ đó; sự kiện sổ (gồm đánh giá) không gắn HĐ mà người đó ghi; công ty
// được tham chiếu; khoá nhắc đã gửi của các HĐ đó. Mọi thứ khác (tài khoản thử/demo) bị loại và chỉ ĐẾM. Index không nhập ở chế
// độ này (CKS, tri thức, hẹn nhắc…) ⇒ đếm bản ghi gắn với người đó vào `not_imported` để vận hành thấy còn sót gì. Thuần.
import { docsOf, type Snapshot, type SourceDoc } from "./context";
import { EXTRA_EXPORT_INDICES } from "./extras-scope.rules";
import { parseRemindKey } from "./map-contracts.rules";
import { lowerEmail, str } from "./values.rules";

/** Index chế độ owner nhập (còn lại chỉ đếm). Danh tính (orgs/users/memberships) không nhập: user đích tạo trước bằng script. */
export const OWNER_INDICES = [
  "contracts",
  "obligations",
  "partner_events",
  "companies",
  "state",
] as const;
const IDENTITY = new Set(["orgs", "users", "memberships"]);
/** Trường nguồn chỉ người: dùng để nhận bản ghi "của" chủ ở index không nhập. */
const PERSON_KEYS = ["owner_email", "created_by", "by", "email", "user_email", "user", "done_by"];

export type OwnerScope = {
  snap: Snapshot;
  /** Org nguồn của các HĐ được chọn (thường MỘT). */
  orgs: string[];
  /** Bản ghi nguồn của tài khoản khác bị loại, theo index. */
  excluded: Record<string, number>;
  /** Bản ghi của chủ ở index KHÔNG nhập (CKS, tri thức, chat…), theo index. */
  not_imported: Record<string, number>;
};

const mine = (email: string, v: unknown): boolean => lowerEmail(v) === email;

/** HĐ của chủ: phụ trách = email, hoặc chưa giao mà chủ tạo. Phụ lục của HĐ đã chọn đi theo HĐ cha. */
function pickContracts(all: SourceDoc[], email: string): SourceDoc[] {
  const own = (d: SourceDoc) =>
    d.src.owner_email ? mine(email, d.src.owner_email) : mine(email, d.src.created_by);
  const ids = new Set(all.filter(own).map((d) => d.id));
  for (const d of all)
    if (d.src.kind === "addendum" && ids.has(String(d.src.parent_id ?? ""))) ids.add(d.id);
  return all.filter((d) => ids.has(d.id));
}

function pickLedger(s: Snapshot, email: string, contracts: Set<string>) {
  const obligations = docsOf(s, "obligations").filter((d) =>
    contracts.has(String(d.src.contract_id ?? "")),
  );
  const obIds = new Set(obligations.map((d) => d.id));
  const events = docsOf(s, "partner_events").filter((d) => {
    const c = str(d.src.contract_id, 128);
    const o = str(d.src.obligation_id, 128);
    if (c) return contracts.has(c);
    if (o) return obIds.has(o);
    return mine(email, d.src.by); // đánh giá / sự kiện sổ tự do do chủ ghi
  });
  const companyIds = new Set(
    [...obligations, ...events].map((d) => str(d.src.company_id, 300)).filter(Boolean),
  );
  const companies = docsOf(s, "companies").filter((d) => companyIds.has(d.id));
  return { obligations, events, companies };
}

/** Bản ghi của chủ ở index không nhập: trường người = email, hoặc trỏ HĐ đã chọn. */
function notImported(s: Snapshot, email: string, contracts: Set<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [ix, docs] of Object.entries(s.docs)) {
    if (
      IDENTITY.has(ix) ||
      (OWNER_INDICES as readonly string[]).includes(ix) ||
      EXTRA_EXPORT_INDICES.includes(ix) // niti-import2: có đường nhập riêng (`--include-extras`)
    )
      continue;
    const n = docs.filter(
      (d) =>
        PERSON_KEYS.some((k) => mine(email, d.src[k])) ||
        contracts.has(String(d.src.contract_id ?? "")),
    ).length;
    if (n > 0) out[ix] = n;
  }
  return out;
}

export function scopeToOwner(s: Snapshot, ownerEmail: string): OwnerScope {
  const email = ownerEmail.trim().toLowerCase();
  const contracts = pickContracts(docsOf(s, "contracts"), email);
  const cids = new Set(contracts.map((d) => d.id));
  const { obligations, events, companies } = pickLedger(s, email, cids);
  const state = docsOf(s, "state").filter((d) => {
    const k = parseRemindKey(d.id);
    return k !== null && cids.has(k.contract);
  });
  const docs: Snapshot["docs"] = {
    contracts,
    obligations,
    partner_events: events,
    companies,
    state,
  };
  const excluded: Record<string, number> = {};
  for (const ix of OWNER_INDICES) {
    const n = docsOf(s, ix).length - (docs[ix]?.length ?? 0);
    if (n > 0) excluded[ix] = n;
  }
  const orgs = [...new Set(contracts.map((d) => str(d.src.org_id, 128)).filter(Boolean))];
  return {
    snap: { docs, graph: {} },
    orgs: orgs as string[],
    excluded,
    not_imported: notImported(s, email, cids),
  };
}

/** Chủ HĐ trong ảnh chụp (để tìm email của tài khoản cần nhập): email, tên (index users), org, số HĐ. */
export function contractOwners(
  s: Snapshot,
): { email: string; name: string | null; orgs: string[]; contracts: number }[] {
  const names = new Map(
    docsOf(s, "users").map((u) => [
      lowerEmail(u.src.email) ?? u.id.toLowerCase(),
      str(u.src.name, 200),
    ]),
  );
  const by = new Map<string, { orgs: Set<string>; n: number }>();
  for (const d of docsOf(s, "contracts")) {
    const e = lowerEmail(d.src.owner_email) ?? lowerEmail(d.src.created_by);
    if (!e) continue;
    const x = by.get(e) ?? { orgs: new Set<string>(), n: 0 };
    x.n++;
    x.orgs.add(String(d.src.org_id ?? ""));
    by.set(e, x);
  }
  return [...by]
    .map(([email, x]) => ({
      email,
      name: names.get(email) ?? null,
      orgs: [...x.orgs],
      contracts: x.n,
    }))
    .sort((a, b) => b.contracts - a.contracts);
}
