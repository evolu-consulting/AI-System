// CR-127 · U2 · FLOW-FR-12…14 · spec §8.1: phép sửa THUẦN cho màn soạn danh sách dọc. Bản nháp editor (`StageDraft[]`) ⇒ cây (`outline.ts`) ⇒
// sửa cây (chèn / xoá / đổi chỗ) ⇒ bản nháp mới (giữ `uid` theo mã bước). Không React, không API. Cây luôn qua `withDefaultEnds`
// (Hoàn tất cuối + đích Từ chối / Trả lại) trước khi quay về bản nháp — người dùng không thấy / không vẽ node Kết thúc.
import { type ProcessStageDef, resolveSteps } from "@ai/contracts/hub-admin";
import type { StageDraft } from "./draft-types";
import { withNodeDefaults } from "./node-defaults";
import {
  isUnsupported,
  type Outline,
  type OutlineNode,
  type OutlineResult,
  outlineNodes,
  outlineToStages,
  stagesToOutline,
  walkOutline,
} from "./outline";
import { CONTRACT_OUTCOMES, type EndOutcomes, withDefaultEnds } from "./outline-ends";
import { stageToDraft, stageToInput } from "./stage-convert";

/** Vị trí một danh sách trong cây: đường chính (`null`) hoặc một nhánh của node Nếu. */
export type Loc = { ifKey: string; side: "yes" | "no" } | null;

const UNREADABLE: OutlineResult = {
  kind: "unsupported",
  code: "bad_target",
  reason: "Quy trình chưa mở được dưới dạng danh sách: sửa các bước đang lỗi rồi mở lại.",
};

/** Bản nháp ⇒ cây; bản nháp dở dang không đổi được sang định dạng lưu ⇒ `Unsupported`. */
export function outlineOfDraft(stages: readonly StageDraft[]): OutlineResult {
  try {
    return stagesToOutline(stages.map(stageToInput));
  } catch {
    return UNREADABLE;
  }
}

/** Cây ⇒ bản nháp: đánh số bước lại; bước còn mã cũ giữ `uid` (panel đang mở không mất chọn). */
export function draftFromOutline(old: readonly StageDraft[], o: Outline): StageDraft[] {
  const defs = outlineToStages(o);
  const steps = resolveSteps(defs);
  const uidOf = new Map(old.map((s) => [s.key, s.uid]));
  return defs.map((d, i) => {
    const s = stageToDraft(d, steps[i] as number);
    const uid = uidOf.get(d.key);
    return uid ? { ...s, uid } : s;
  });
}

const sig = (o: Outline) => JSON.stringify(outlineToStages(o));

/** Thiếu Hoàn tất / đích Từ chối, Trả lại ⇒ bản nháp đã bổ sung; đủ rồi hoặc không đọc được ⇒ `null`. */
export function ensureEnds(
  stages: readonly StageDraft[],
  ends: EndOutcomes = CONTRACT_OUTCOMES,
): StageDraft[] | null {
  const o = outlineOfDraft(stages);
  if (isUnsupported(o)) return null;
  const next = withDefaultEnds(o, ends);
  return sig(next) === sig(o) ? null : draftFromOutline(stages, next);
}

function listAt(o: Outline, loc: Loc): OutlineNode[] | null {
  if (!loc) return o.items;
  let hit: OutlineNode[] | null = null;
  walkOutline(o.items, (n) => {
    if (n.kind === "if" && n.stage.key === loc.ifKey) hit = loc.side === "yes" ? n.yes : n.no;
  });
  return hit;
}

/** Node mới (đã có mã / tên tệp / mẫu mặc định duy nhất trong flow) từ bản nháp bước mẫu. */
export function nodeFromDraft(fresh: StageDraft, taken: readonly string[]): OutlineNode {
  const s = withNodeDefaults(fresh, taken);
  const stage = stageToInput(s);
  const isIf = (stage.executor as { kind: string }).kind === "if";
  return isIf
    ? { kind: "if", stage, refs: {}, yes: [], no: [] }
    : { kind: "step", stage, refs: {} };
}

/** Chèn `nodes` vào `loc` tại vị trí `index` (Hoàn tất cuối đường chính không bị chèn sau). Không tìm thấy danh sách ⇒ cây cũ. */
export function insertNodes(o: Outline, loc: Loc, index: number, nodes: OutlineNode[]): Outline {
  const out = structuredClone(o);
  const list = listAt(out, loc);
  if (!list) return o;
  const last = list[list.length - 1];
  const cap = !loc && last?.kind === "end" ? list.length - 1 : list.length;
  list.splice(Math.min(Math.max(index, 0), cap), 0, ...nodes);
  return out;
}

const refKeys = (n: OutlineNode): string[] => {
  const r = n.refs;
  return [r.reject, r.ret, ...(r.branches ?? []), ...(r.rules ?? []), ...(r.back ?? [])].filter(
    (k): k is string => typeof k === "string",
  );
};

/** Bỏ node Kết thúc ngoài đường chính không còn ai trỏ tới (tránh `orphan` khi mở lại). */
function pruneExits(o: Outline): void {
  const used = new Set<string>();
  walkOutline(o.items, (n) => {
    for (const k of refKeys(n)) used.add(k);
  });
  o.exits = o.exits.filter((x) => used.has(x.stage.key));
}

/** Khoảng [from, to] các bước liền kề cùng node module với `list[i]` (vd Ký số = gửi + chờ); node khác ⇒ chỉ chính nó. */
function clusterSpan(list: readonly OutlineNode[], i: number): [number, number] {
  const mod = list[i]?.stage.node;
  const same = (j: number) => list[j]?.stage.node === mod && list[j]?.kind === "step";
  let from = i;
  let to = i;
  if (mod) {
    while (from > 0 && same(from - 1)) from--;
    while (to < list.length - 1 && same(to + 1)) to++;
  }
  return [from, to];
}

/** Xoá node `key` khỏi danh sách (hoặc nhánh bên trong); trả `true` khi đã gặp node (Hoàn tất thì không xoá). */
function stripKey(list: OutlineNode[], key: string): boolean {
  const i = list.findIndex((n) => n.stage.key === key);
  if (i < 0)
    return list.some((n) => n.kind === "if" && (stripKey(n.yes, key) || stripKey(n.no, key)));
  if (list[i]?.kind === "end") return true;
  const [from, to] = clusterSpan(list, i);
  list.splice(from, to - from + 1);
  return true;
}

/**
 * Xoá node `key` (+ mọi bước liền kề cùng node module; node Nếu ⇒ xoá cả hai nhánh). Hoàn tất không xoá được.
 * Đích Từ chối / Trả lại trỏ vào node đã xoá về mặc định khi `withDefaultEnds` chạy lại.
 */
export function removeNode(
  o: Outline,
  key: string,
  ends: EndOutcomes = CONTRACT_OUTCOMES,
): Outline {
  const out = structuredClone(o);
  stripKey(out.items, key);
  pruneExits(out);
  return withDefaultEnds(out, ends);
}

/** Đổi chỗ node `key` với node kề (`dir` −1 lên / +1 xuống) trong cùng danh sách; Hoàn tất cố định cuối. */
export function moveNode(o: Outline, key: string, dir: -1 | 1): Outline {
  const out = structuredClone(o);
  const move = (list: OutlineNode[]): boolean => {
    const i = list.findIndex((n) => n.stage.key === key);
    if (i >= 0) {
      const j = i + dir;
      if (j < 0 || j >= list.length || list[i]?.kind === "end" || list[j]?.kind === "end")
        return true;
      [list[i], list[j]] = [list[j] as OutlineNode, list[i] as OutlineNode];
      return true;
    }
    return list.some((n) => n.kind === "if" && (move(n.yes) || move(n.no)));
  };
  move(out.items);
  return out;
}

/** Mọi mã bước đang dùng (để đặt mã mới không trùng). */
export const takenKeys = (o: Outline): string[] => outlineNodes(o).map((n) => n.stage.key);

/** Có thể xoá / đổi chỗ node này không (Hoàn tất thì không). */
export const isFixed = (n: OutlineNode): boolean => n.kind === "end";

export type { ProcessStageDef };
