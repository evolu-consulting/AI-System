// HUB-FR-106…113 · N5 · `POST /__mock/process` (không thuộc contract, không auth): đẩy run fixture sang bước kế để FE
// thấy sự kiện sống (`process.updated`, `review_task.*`, `process.notice`, `room.message` tin `process`).
// `leave` (thêm ngoài plan): A rời phòng R ⇒ persona `lan-left` (U5); `POST /__mock/reset` khôi phục.
import { Hono } from "hono";
import { z } from "zod";
import { chatError, parseBody } from "../http";
import { addOutput, openAsk, openDecision } from "./actions";
import { PERSONA } from "./fixtures";
import { isActive, type MockRun, type ProcessState } from "./state";

const BodySchema = z.strictObject({
  run_id: z.uuid().optional(),
  action: z.enum(["advance", "output", "ask", "decision", "finish", "leave"]),
  user_id: z.uuid().optional(),
});

const STEP: Record<
  Exclude<z.infer<typeof BodySchema>["action"], "leave">,
  (s: ProcessState, r: MockRun) => void
> = {
  advance: (s, r) => s.advance(r, null),
  output: (s, r) => {
    addOutput(s, r);
  },
  ask: (s, r) => {
    openAsk(s, r, "Cần thêm thông tin gì?", ["Có", "Không"]);
  },
  decision: (s, r) => {
    openDecision(s, r, "redo_limit");
  },
  finish: (s, r) => s.finish(r, "done", null),
};

export function createProcessControlRoutes(s: ProcessState): Hono {
  const app = new Hono();
  app.post("/__mock/process", async (c) => {
    const b = await parseBody(c, BodySchema);
    if (!b.ok) return chatError(c, "VALIDATION_ERROR", b.issues);
    if (b.data.action === "leave") {
      s.left.add(b.data.user_id ?? PERSONA.A.id);
      return c.body(null, 204);
    }
    const r = b.data.run_id ? s.run(b.data.run_id) : undefined;
    if (!r) return chatError(c, "NOT_FOUND");
    if (!isActive(r.status))
      return c.json({ error: { code: "PROCESS_RUN_STATE", message: "Run ended" } }, 409);
    for (const t of s.openTasks(r.id)) s.close(t, "superseded", null);
    STEP[b.data.action](s, r);
    return c.body(null, 204);
  });
  return app;
}
