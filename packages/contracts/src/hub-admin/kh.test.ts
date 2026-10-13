// HUB-FR-131 · HUB-FR-132 · unit contract KH (spec K1 §3.1–3.2) — phần qc R80–R89 chưa phủ.
import { describe, expect, it } from "bun:test";
import {
  AgentKnowledgeRequestSchema,
  KhCheckItemSchema,
  KhConnectionListQuerySchema,
  KhConnectionUpdateSchema,
} from "./kh";

const u = (n: number) => `c1a10000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("kh contract", () => {
  it("HUB-FR-131 · level phải khớp nhóm code", () => {
    expect(KhCheckItemSchema.safeParse({ code: "kh_timeout", level: "warning" }).success).toBe(
      false,
    );
    expect(KhCheckItemSchema.safeParse({ code: "kh_projects_empty", level: "error" }).success).toBe(
      false,
    );
  });
  it("HUB-FR-132 · connection_ids trùng / > 5 ⇒ lỗi tại path connection_ids", () => {
    const dup = AgentKnowledgeRequestSchema.safeParse({ connection_ids: [u(1), u(1)], version: 1 });
    expect(dup.success).toBe(false);
    expect(dup.error?.issues[0]?.path).toEqual(["connection_ids"]);
    const many = Array.from({ length: 6 }, (_, i) => u(i + 1));
    const r = AgentKnowledgeRequestSchema.safeParse({ connection_ids: many, version: 1 });
    expect(r.error?.issues[0]?.path).toEqual(["connection_ids"]);
    expect(AgentKnowledgeRequestSchema.safeParse({ connection_ids: [], version: 1 }).success).toBe(
      true,
    );
  });
  it("HUB-FR-131 · PUT cần version; list limit mặc định 50, ≤ 100", () => {
    const body = { name: "kh-main", base_url: "https://kh.example.com", secret_id: u(1) };
    expect(KhConnectionUpdateSchema.safeParse(body).success).toBe(false);
    expect(KhConnectionUpdateSchema.parse({ ...body, version: 2 }).summary_project).toBeNull();
    expect(KhConnectionListQuerySchema.parse({}).limit).toBe(50);
    expect(KhConnectionListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });
});
