// niti-import2 · `--include-extras`: phần CÒN LẠI của MỘT tài khoản mgmt-app (chat + file chat, văn bản ký + chứng thư CKS, thông
// báo, báo giá, quét giá, lịch sử chấm điểm) vào tenant đích, thuộc user đích, nhãn lô RIÊNG (`--source`, vd `sohoptac-tien-extras`).
// Chỉ bản ghi thuộc org cũ của chủ, bỏ "[E2E]"; góp ý không nhập (người dùng chốt 2026-10-21). Dry-run (mặc định): kế hoạch + trạng
// thái đích, không ghi, không tải file. Apply: file chat → FileBox, MỖI hội thoại một tx, thông báo (đã đọc, không phát), hàng gói
// (mỗi bảng một tx + sổ đăng ký) — id tất định + ON CONFLICT ⇒ chạy lại 0 hàng. Không chạy agent, không gửi email/push.
import { type ConvUnit, planChats } from "../domain/extras-chat.rules";
import { EXTRA_TABLES, planContractsExtras } from "../domain/extras-contracts.rules";
import { EXTRA_INDICES, extrasFor, keepExtras } from "../domain/extras-scope.rules";
import { scopeToOwner } from "../domain/owner-scope.rules";
import { bump } from "../domain/plan";
import type { Issue } from "../domain/values.rules";
import { chatChecksums, type ExtraFileStats, placeChatFiles } from "./extras-files";
import type { ExtrasDeps, ExtrasOpts, ExtrasState } from "./extras-ports";
import { loadIndices } from "./owner-export";

type Line = {
  source_all: number;
  excluded_other_org: number;
  excluded_e2e: number;
  source: number;
  planned: number;
  target: number;
};
export type ExtrasReport = {
  mode: "dry-run" | "apply";
  source: string;
  link_source: string;
  tenant: { key: string; id: string };
  owner: { email: string; username: string; user_id: string };
  org: string;
  ms: number;
  counts: Record<string, Line>;
  files: ExtraFileStats;
  /** my-chat-history chỉ thấy tin trong cửa sổ `chat_history_months` của tenant. */
  retention: { months: number; messages_older: number; oldest_message_at: string | null };
  /** Giao nhận email/push của user đích — phải 0. */
  deliveries: number;
  notifications_unread: number;
  notes: Record<string, number>;
  issues_by_code: Record<string, number>;
  issues_sample: Issue[];
  not_imported: string[];
};
export type ExtrasRollbackReport = {
  mode: "dry-run" | "apply";
  source: string;
  before: ExtrasState;
  deleted: Record<string, number>;
  after: ExtrasState | null;
  error: string | null;
};

const READ = [...EXTRA_INDICES, "market_observations", "companies", "contracts"];

async function resolve(d: ExtrasDeps, o: ExtrasOpts) {
  const t = await d.identity.tenantByKey(o.tenantKey);
  if (!t) throw new Error("TENANT_NOT_FOUND");
  if (!t.active) throw new Error("TENANT_INACTIVE");
  const u = await d.identity.userByUsername(t.id, o.ownerUsername);
  if (!u || !u.active) throw new Error("OWNER_USER_NOT_FOUND");
  return { tid: t.id, uid: u.id };
}

async function scoped(d: ExtrasDeps, o: ExtrasOpts, email: string) {
  const snap = await loadIndices(d.reader, o.batch, READ);
  const main = scopeToOwner(snap, email);
  const org = o.org ?? (main.orgs.length === 1 ? (main.orgs[0] as string) : null);
  if (!org) throw new Error("EXTRAS_ORG_REQUIRED");
  const cids = new Set((main.snap.docs.contracts ?? []).map((x) => x.id));
  return { org, cids, kept: keepExtras(extrasFor(snap, email, cids), org) };
}

const monthsAgo = (now: Date, m: number) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - m);
  return d.toISOString();
};

function retention(units: ConvUnit[], months: number, now: Date) {
  const ts = units.flatMap((u) => u.messages.map((m) => String(m.created_at))).sort();
  const lo = monthsAgo(now, months);
  return {
    months,
    messages_older: ts.filter((t) => t < lo).length,
    oldest_message_at: ts[0] ?? null,
  };
}

async function writeAll(
  d: ExtrasDeps,
  x: { tid: string; uid: string; o: ExtrasOpts },
  p: {
    units: ConvUnit[];
    att: Map<string, Record<string, unknown>[]>;
    c: ReturnType<typeof planContractsExtras>;
  },
) {
  for (const u of p.units)
    await d.store.writeConversation(x.tid, x.uid, x.o.source, {
      conv: u.conv,
      flow: u.flow,
      messages: u.messages,
      attachments: p.att.get(String(u.conv.id)) ?? [],
    });
  for (let i = 0; i < p.c.notifications.length; i += 500)
    await d.store.writeNotifications(x.tid, x.uid, x.o.source, p.c.notifications.slice(i, i + 500));
  for (const t of EXTRA_TABLES)
    for (let i = 0; i < p.c.rows[t].length; i += x.o.batch)
      await d.store.writeContracts(x.tid, x.o.source, t, p.c.rows[t].slice(i, i + x.o.batch));
}

function counts(
  k: ReturnType<typeof keepExtras>,
  p: { units: ConvUnit[]; c: ReturnType<typeof planContractsExtras>; att: number },
  st: ExtrasState,
) {
  const chatUnits = p.units.filter((u) => !u.orphan);
  const chatIds = new Set(chatUnits.map((u) => String(u.conv.id)));
  const legacy = (kind: string) => p.c.rows.legacy_records.filter((r) => r.kind === kind).length;
  const reg = (key: string) => st.contracts[key] ?? 0;
  const L = (ix: string, planned: number, target: number, source?: number): Line => ({
    source_all: k.source_all[ix] ?? source ?? 0,
    excluded_other_org: k.excluded_other_org[ix] ?? 0,
    excluded_e2e: k.excluded_e2e[ix] ?? 0,
    source: source ?? (k.docs[ix as keyof typeof k.docs] ?? []).length,
    planned,
    target,
  });
  return {
    chats: L("chats", chatUnits.length, st.conversation_ids.filter((id) => chatIds.has(id)).length),
    conversations: L("_", p.units.length, st.conversation_ids.length, p.units.length),
    messages: L(
      "_",
      p.units.reduce((a, u) => a + u.messages.length, 0),
      st.messages,
      p.units.reduce((a, u) => a + u.messages.length, 0),
    ),
    chat_files: L("chat_files", p.att, st.attachments.length),
    signed_docs: L("signed_docs", p.c.rows.cks_signed_docs.length, reg("cks_signed_docs")),
    cks_certificates: L(
      "cks_certificates",
      p.c.rows.cks_certificates.length,
      reg("cks_certificates"),
    ),
    cks_customers: L(
      "_",
      p.c.rows.cks_customers.length,
      reg("cks_customers"),
      p.c.rows.cks_customers.length,
    ),
    notifications: L("notifications", p.c.notifications.length, st.notifications),
    quotes: L("quotes", p.c.rows.price_quotes.length, reg("price_quotes")),
    market_scans: L("market_scans", legacy("market_scans"), reg("legacy_records:market_scans")),
    market_prices: L(
      "_",
      p.c.rows.cks_market_prices.length,
      reg("cks_market_prices"),
      (k.docs.market_observations ?? []).length,
    ),
    score_config_history: L(
      "score_config_history",
      legacy("score_config_history"),
      reg("legacy_records:score_config_history"),
    ),
  };
}

export async function runExtrasImport(o: ExtrasOpts, d: ExtrasDeps): Promise<ExtrasReport> {
  const t0 = d.now();
  const email = o.ownerEmail.trim().toLowerCase();
  const { tid, uid } = await resolve(d, o);
  if (o.meta && o.meta.owner_email !== email) throw new Error("EXPORT_OWNER_MISMATCH");
  const { org, cids, kept } = await scoped(d, o, email);
  const issues: Issue[] = [];
  const now = d.clock();
  const chat = planChats(
    { source: o.source, tenantId: tid, userId: uid, now: now.toISOString() },
    kept.docs.chats ?? [],
    kept.docs.chat_files ?? [],
  );
  const c = planContractsExtras(
    { source: o.source, linkSource: o.linkSource, userId: uid, contracts: cids, org, issues },
    kept.docs,
  );
  const files: ExtraFileStats = {
    jobs: 0,
    found: 0,
    uploaded: 0,
    existing: 0,
    pending: 0,
    unsupported: chat.unsupported,
    checksum_ok: 0,
    checksum_bad: 0,
  };
  const placed = await placeChatFiles(
    d,
    { tid, uid, apply: o.apply, org: o.hubFileOrg, units: chat.units, issues },
    files,
  );
  if (o.apply) await writeAll(d, { tid, uid, o }, { units: chat.units, att: placed.rows, c });
  const st = await d.store.state(tid, uid, o.source);
  if (o.apply) {
    const sum = await chatChecksums(d, o.hubFileOrg, st, placed.shas);
    files.checksum_ok = sum.ok;
    files.checksum_bad = sum.bad;
  }
  const byCode: Record<string, number> = {};
  for (const i of issues) bump(byCode, i.code);
  if (files.checksum_bad > 0) bump(byCode, "FILE_CHECKSUM_MISMATCH", files.checksum_bad);
  if (st.deliveries > 0) bump(byCode, "NOTIFICATION_DELIVERY", st.deliveries);
  const notes = {
    ...c.notes,
    ...(chat.messages_skipped_empty ? { messages_skipped_empty: chat.messages_skipped_empty } : {}),
  };
  return {
    mode: o.apply ? "apply" : "dry-run",
    source: o.source,
    link_source: o.linkSource,
    tenant: { key: o.tenantKey, id: tid },
    owner: { email, username: o.ownerUsername, user_id: uid },
    org,
    ms: Math.round(d.now() - t0),
    counts: counts(
      kept,
      { units: chat.units, c, att: chat.units.reduce((a, u) => a + u.files.length, 0) },
      st,
    ),
    files,
    retention: retention(chat.units, await d.store.retentionMonths(tid), now),
    deliveries: st.deliveries,
    notifications_unread: st.notifications_unread,
    notes,
    issues_by_code: byCode,
    issues_sample: issues.slice(0, 50),
    not_imported: ["feedback"],
  };
}

export async function runExtrasRollback(
  o: ExtrasOpts,
  d: ExtrasDeps,
): Promise<ExtrasRollbackReport> {
  const { tid, uid } = await resolve(d, o);
  const before = await d.store.state(tid, uid, o.source);
  if (!o.apply)
    return { mode: "dry-run", source: o.source, before, deleted: {}, after: null, error: null };
  const deleted = await d.store.rollback(tid, uid, o.source);
  return {
    mode: "apply",
    source: o.source,
    before,
    deleted,
    after: await d.store.state(tid, uid, o.source),
    error: null,
  };
}

/** exit 2: vấn đề hàng / sai sha / có giao nhận email-push / hoàn tác bị từ chối. */
export function extrasBad(r: ExtrasReport | ExtrasRollbackReport): boolean {
  if ("error" in r) return r.error !== null;
  return Object.keys(r.issues_by_code).length > 0;
}
