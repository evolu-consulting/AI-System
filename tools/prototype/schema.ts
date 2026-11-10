// Bản mẫu bấm được (pl-prototype): lược đồ prototype.json — nhỏ, chỉ đủ để người nghiệp vụ xác nhận màn hình/luồng.
import { z } from "zod";

const str = z.string().min(1);

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
]);

export const blockSchema = z.union([
  leafBlock,
  z.object({
    type: z.literal("states"),
    variants: z.array(z.object({ key: str, label: str, blocks: z.array(leafBlock) })).min(1),
  }),
]);

const prototypeSchemaBase = z.object({
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
    .min(1)
    .max(8),
  flow: z.array(z.object({ from: str, action: str, to: str, by: str })).default([]),
  notes: z.array(z.string()).default([]),
});

export const prototypeSchema = prototypeSchemaBase.superRefine((p, ctx) => {
  for (const message of crossErrors(p)) ctx.addIssue({ code: "custom", message });
});

type Screen = z.infer<typeof prototypeSchemaBase>["screens"][number];

function screenErrors(s: Screen, ids: Set<string>, roles: Set<string>): string[] {
  const out: string[] = [];
  if (s.role && !roles.has(s.role)) out.push(`màn ${s.id}: vai không có: ${s.role}`);
  const leaves = s.blocks.flatMap((b) =>
    b.type === "states" ? b.variants.flatMap((v) => v.blocks) : [b],
  );
  for (const b of leaves) {
    if (b.type !== "button") continue;
    if (b.goto && !ids.has(b.goto))
      out.push(`màn ${s.id}: nút "${b.label}" đi tới màn không có: ${b.goto}`);
    if (b.role && !roles.has(b.role))
      out.push(`màn ${s.id}: nút "${b.label}" vai không có: ${b.role}`);
  }
  return out;
}

function crossErrors(p: z.infer<typeof prototypeSchemaBase>): string[] {
  const ids = new Set(p.screens.map((s) => s.id));
  const roles = new Set(p.roles.map((r) => r.key));
  const out = ids.size !== p.screens.length ? ["id màn hình bị trùng"] : [];
  for (const s of p.screens) out.push(...screenErrors(s, ids, roles));
  for (const f of p.flow) if (!roles.has(f.by)) out.push(`luồng: vai không có: ${f.by}`);
  return out;
}

export type Prototype = z.infer<typeof prototypeSchema>;
export type PrototypeInput = z.input<typeof prototypeSchema>;
