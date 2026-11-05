// CR-120 §2 · ADR-0036 · FLOW-FR-01/02 · luật thuần "app phải khai báo khe": dùng bởi `bun run check:app-slots` (pre-commit + CI) và
// kiểm lúc mount gói. Đỏ khi: app 0 khe, không khe nào luôn bật (người dùng 2026-11-05), `allowedKinds` rỗng/lạ, `defaultDefKey` sai
// dạng `ProcessKey`, key khe sai dạng/khác tiền tố app/trùng, `purpose`/`trigger` rỗng hoặc quá dài.
import { PROCESS_KEY_RE } from "../chat/processes";
import { FLOW_STEP_KINDS } from "../flow/view";
import {
  type AppManifest,
  type AppSlotDecl,
  SLOT_PURPOSE_MAX,
  SLOT_TRIGGER_MAX,
  slotAlwaysOn,
} from "./manifest";

/** Cùng regex CHECK `process_slots_slot_ck` (hub 0068) và `SLOT_KEY_RE` của kit. */
export const APP_SLOT_KEY_RE = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$/;

export type AppSlotIssue = { app: string; slot?: string; rule: string };

const KINDS: ReadonlySet<string> = new Set(FLOW_STEP_KINDS);

function textIssue(v: string, max: number): boolean {
  return v.trim().length === 0 || v.length > max;
}

/** Luật của MỘT khe theo thứ tự cố định (mã luật → vi phạm). */
function slotRules(appKey: string, s: AppSlotDecl): [string, boolean][] {
  const keyOk = APP_SLOT_KEY_RE.test(s.key);
  return [
    ["slot_key_format", !keyOk],
    ["slot_key_prefix", keyOk && s.key.split(".")[0] !== appKey],
    ["allowed_kinds_empty", s.allowedKinds.length === 0],
    ["allowed_kinds_unknown", s.allowedKinds.some((k) => !KINDS.has(k))],
    ["default_def_key_format", !PROCESS_KEY_RE.test(s.defaultDefKey)],
    ["purpose", textIssue(s.purpose, SLOT_PURPOSE_MAX)],
    ["trigger", textIssue(s.trigger, SLOT_TRIGGER_MAX)],
  ];
}

function appRule(m: AppManifest): string | null {
  if (m.slots.length === 0) return "no_slots";
  return m.slots.some(slotAlwaysOn) ? null : "no_always_on_slot";
}

/** Mọi vi phạm của tập manifest (rỗng ⇒ hợp lệ). Key khe trùng xét trên TOÀN tập. */
export function appSlotIssues(manifests: readonly AppManifest[]): AppSlotIssue[] {
  const out: AppSlotIssue[] = [];
  const seen = new Set<string>();
  for (const m of manifests) {
    const r = appRule(m);
    if (r) out.push({ app: m.key, rule: r });
    for (const s of m.slots) {
      const rules = slotRules(m.key, s).filter(([, bad]) => bad);
      if (seen.has(s.key)) rules.push(["slot_key_duplicate", true]);
      seen.add(s.key);
      for (const [rule] of rules) out.push({ app: m.key, slot: s.key, rule });
    }
  }
  return out;
}

export const formatSlotIssue = (i: AppSlotIssue): string =>
  `${i.app}${i.slot ? ` · ${i.slot}` : ""}: ${i.rule}`;
