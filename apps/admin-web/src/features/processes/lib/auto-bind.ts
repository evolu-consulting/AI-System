// CR-125 · m4 · MOD-FR-12 · tự nối đầu vào lúc THÊM node (trình sửa): nguồn tại chỗ đặt = đầu ra "Bắt đầu khi" + đầu ra các node đã có;
// đầu vào có đúng MỘT nguồn (luật chung `autoMapInputs` của contracts) ⇒ nối vào tham số tool cùng tên; còn lại ⇒ hỏi bằng câu nghiệp vụ.
import type { AppNodeDecl, AppNodeIo } from "@ai/contracts/app-manifest";
import type { ProcessToolItem } from "@ai/contracts/hub-admin";
import { autoMapInputs, type MapSource } from "@ai/contracts/modules";
import { inputSourceType } from "../domain/tool-rules";
import type { StageDraft } from "./draft-types";
import { hasArg } from "./tool-form";

/** Nguồn có sẵn: "Bắt đầu khi" + đầu ra của các node (theo khoá) đã đặt trong flow. */
export function mapSources(
  start: readonly AppNodeIo[],
  placed: readonly string[],
  byKey: ReadonlyMap<string, AppNodeDecl>,
): MapSource[] {
  const fromStart = start.map((o) => ({
    id: o.key,
    key: o.key,
    type: o.type,
    from: "start" as const,
  }));
  const fromSteps = [...new Set(placed)].flatMap((k) =>
    (byKey.get(k)?.outputs ?? []).map((o) => ({
      id: `${k}:${o.key}`,
      key: o.key,
      type: o.type,
      from: "step" as const,
    })),
  );
  return [...fromStart, ...fromSteps];
}

/** Thêm node: mỗi stage tool có tham số trùng khoá đã nối từ "Bắt đầu khi" ⇒ đặt nguồn "đầu vào của quy trình"; trả thêm các câu hỏi còn lại. */
export function autoBindNode(
  node: AppNodeDecl,
  patches: readonly Partial<StageDraft>[],
  sources: readonly MapSource[],
  lang: "vi" | "en",
): { patches: Partial<StageDraft>[]; asks: string[] } {
  const r = autoMapInputs(node.inputs ?? [], sources, {
    node: lang === "vi" ? node.label.vi : node.label.en,
    lang,
  });
  const fromStart = new Set(r.bound.filter((b) => b.from === "start").map((b) => b.key));
  const out = patches.map((p) => {
    if (!p.tool || fromStart.size === 0) return p;
    const args = { ...p.tool.args };
    for (const k of fromStart)
      if (args[k] === undefined) args[k] = { from: "input", value: k, kind: "string" };
    return { ...p, tool: { ...p.tool, args } };
  });
  return { patches: out, asks: r.ask.map((a) => a.message) };
}

/**
 * CR-125 · m4 · MOD-FR-12 · kiểm lúc LƯU dùng cùng `autoMapInputs`: tham số tool BẮT BUỘC chưa khai nguồn mà quy trình có đúng MỘT đầu vào
 * cùng khoá + kiểu ⇒ nối luôn (không báo thiếu); nhiều/không có ⇒ giữ nguyên để báo lỗi như cũ.
 */
export function autoBindArgs(
  stages: readonly StageDraft[],
  inputs: readonly { key: string; type: string }[],
  tools: readonly ProcessToolItem[] | undefined,
): StageDraft[] {
  const sources: MapSource[] = inputs.flatMap((i) => {
    const type = inputSourceType(i.type);
    return type ? [{ id: i.key, key: i.key, type, from: "start" as const }] : [];
  });
  return stages.map((s) => {
    const tool = s.executor === "tool" ? tools?.find((t) => t.key === s.tool.key) : undefined;
    const needs = (tool?.params ?? []).filter((p) => p.required && !hasArg(s.tool, p.name));
    if (needs.length === 0) return s;
    const ios = needs.map((p) => ({
      key: p.name,
      type: (p.type === "number" ? "number" : "string") as "number" | "string",
      required: true,
    }));
    const { bound } = autoMapInputs(ios, sources, { node: s.name });
    if (bound.length === 0) return s;
    const args = { ...s.tool.args };
    for (const b of bound) args[b.key] = { from: "input", value: b.source, kind: "string" };
    return { ...s, tool: { ...s.tool, args } };
  });
}
