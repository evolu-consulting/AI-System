// Bản mẫu bấm được (pl-prototype): lược đồ prototype.json — nhỏ, chỉ đủ để người nghiệp vụ xác nhận màn hình/luồng.
import { z } from "zod";

const str = z.string().min(1);
const tone = z.enum(["ok", "warn", "error", "info", "wait"]).default("info");

export const leafBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: str }),
  z.object({ type: z.literal("text"), text: str }),
  z.object({
    type: z.literal("field"),
    label: str,
    kind: z.enum(["text", "select", "checkbox", "date", "number"]).default("text"),
    value: z.string().default(""),
    options: z.array(z.string()).default([]),
    required: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("table"),
    cols: z.array(str).min(1),
    rows: z.array(z.array(z.string())).default([]),
  }),
  z.object({
    type: z.literal("steps"),
    items: z.array(
      z.object({
        label: str,
        status: z.enum(["done", "open", "waiting"]),
        who: z.string().default(""),
      }),
    ),
  }),
  z.object({
    type: z.literal("button"),
    label: str,
    goto: z.string().optional(),
    variant: z.enum(["primary", "secondary", "danger"]).default("primary"),
    role: z.string().optional(),
  }),
  z.object({
    type: z.literal("banner"),
    kind: z.enum(["info", "warn", "error"]).default("info"),
    text: str,
  }),
  z.object({ type: z.literal("badge"), text: str, tone }),
  z.object({
    type: z.literal("stats"),
    items: z.array(z.object({ label: str, value: str })).min(1),
  }),
  z.object({
    type: z.literal("cards"),
    items: z
      .array(
        z.object({
          title: str,
          text: z.string().default(""),
          badge: z.string().default(""),
          tone,
          goto: z.string().optional(),
        }),
      )
      .min(1),
  }),
  z.object({
    type: z.literal("empty"),
    title: str,
    text: z.string().default(""),
    action: z.string().optional(),
    goto: z.string().optional(),
  }),
  z.object({
    type: z.literal("modal"),
    trigger: str,
    title: str,
    text: str,
    confirm: str,
    cancel: str.default("Để sau"),
    goto: z.string().optional(),
    danger: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("toast"),
    trigger: str,
    kind: z.enum(["success", "error"]).default("success"),
    text: str,
  }),
]);

export const blockSchema = z.union([
  leafBlock,
  z.object({
    type: z.literal("states"),
    variants: z.array(z.object({ key: str, label: str, blocks: z.array(leafBlock) })).min(1),
  }),
  z.object({
    type: z.literal("tabs"),
    tabs: z.array(z.object({ key: str, label: str, blocks: z.array(leafBlock) })).min(1),
  }),
]);

export const questionSchema = z.object({
  id: str,
  screen: z.string().optional(),
  text: str,
  options: z.array(str).min(2),
  default: str,
});

const prototypeSchemaBase = z.object({
  id: z.string().optional(),
  title: str,
  roles: z.array(z.object({ key: str, label: str })).min(1),
  screens: z
    .array(
      z.object({
        id: str,
        title: str,
        role: z.string().optional(),
        blocks: z.array(blockSchema),
      }),
    )
    .min(1),
  flow: z.array(z.object({ from: str, action: str, to: str, by: str })).default([]),
  questions: z.array(questionSchema).default([]),
  notes: z.array(z.string()).default([]),
});

export const prototypeSchema = prototypeSchemaBase.superRefine((p, ctx) => {
  for (const message of crossErrors(p)) ctx.addIssue({ code: "custom", message });
});

type Proto = z.infer<typeof prototypeSchemaBase>;
type Screen = Proto["screens"][number];
type Block = Screen["blocks"][number];
export type Leaf = z.infer<typeof leafBlock>;

export function leavesOf(b: Block): Leaf[] {
  if (b.type === "states") return b.variants.flatMap((v) => v.blocks);
  if (b.type === "tabs") return b.tabs.flatMap((v) => v.blocks);
  return [b];
}

/** Nhãn nút/thẻ/hộp thoại → màn đích (để kiểm goto). */
function gotos(l: Leaf): { label: string; goto?: string; role?: string }[] {
  switch (l.type) {
    case "button":
      return [{ label: l.label, goto: l.goto, role: l.role }];
    case "cards":
      return l.items.map((i) => ({ label: i.title, goto: i.goto }));
    case "empty":
      return [{ label: l.title, goto: l.goto }];
    case "modal":
      return [{ label: l.trigger, goto: l.goto }];
    default:
      return [];
  }
}

function screenErrors(s: Screen, ids: Set<string>, roles: Set<string>): string[] {
  const out: string[] = [];
  if (s.role && !roles.has(s.role)) out.push(`màn ${s.id}: vai không có: ${s.role}`);
  for (const l of s.blocks.flatMap(leavesOf)) {
    for (const g of gotos(l)) {
      if (g.goto && !ids.has(g.goto))
        out.push(`màn ${s.id}: nút "${g.label}" đi tới màn không có: ${g.goto}`);
      if (g.role && !roles.has(g.role))
        out.push(`màn ${s.id}: nút "${g.label}" vai không có: ${g.role}`);
    }
  }
  return out;
}

function dup(keys: string[], what: string): string[] {
  return new Set(keys).size !== keys.length ? [`${what} bị trùng`] : [];
}

function crossErrors(p: Proto): string[] {
  const ids = new Set(p.screens.map((s) => s.id));
  const roles = new Set(p.roles.map((r) => r.key));
  const out = [
    ...dup(
      p.screens.map((s) => s.id),
      "id màn hình",
    ),
    ...dup(
      p.questions.map((q) => q.id),
      "id câu hỏi",
    ),
  ];
  for (const s of p.screens) out.push(...screenErrors(s, ids, roles));
  for (const f of p.flow) {
    if (!roles.has(f.by)) out.push(`luồng: vai không có: ${f.by}`);
    for (const e of [f.from, f.to]) if (!ids.has(e)) out.push(`luồng: màn không có: ${e}`);
  }
  for (const q of p.questions) {
    if (q.screen && !ids.has(q.screen)) out.push(`câu hỏi ${q.id}: màn không có: ${q.screen}`);
    if (!q.options.includes(q.default)) out.push(`câu hỏi ${q.id}: gợi ý không nằm trong lựa chọn`);
  }
  return out;
}

export type Prototype = z.infer<typeof prototypeSchema>;
export type PrototypeInput = z.input<typeof prototypeSchema>;
