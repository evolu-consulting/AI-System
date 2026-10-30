// dlc-dify · route node HTTP của Dify gọi (KHÔNG JWT; `Authorization: Bearer <vé flow>`, thiếu/sai ⇒ 401):
//   POST /dify/agent-calls   {agent_key, prompt, wait_s?, skip?} — giao việc cho agent và CHỜ (qua cả các lượt hỏi user);
//   POST /dify/answers       {answer, agent_key?}               — chuyển lời user cho bước đang chờ (tool của dlc-agent);
//   GET  /dify/waiting                                           — các bước đang chờ user trong hội thoại;
//   POST /dify/agents/spawn  {project, template, agents[]}       — sinh agent domain/QC từ plan đã duyệt.
// Trả 200 kể cả agent lỗi (Dify rẽ nhánh theo `status`).
import { Hono } from "hono";
import { z } from "zod";
import { appError } from "../../lib/errors";
import { parseJson } from "../../lib/http";
import { AGENT_CALL_MAX_WAIT_S, type AgentCallService } from "./agent-call.service";
import type { SpawnService } from "./spawn.service";

const KEY = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const CallSchema = z.strictObject({
  agent_key: z.union([KEY, z.literal("")]),
  prompt: z.string().max(200_000),
  wait_s: z.number().int().min(10).max(AGENT_CALL_MAX_WAIT_S).optional(),
  skip: z.boolean().optional(),
});
const AnswerSchema = z.strictObject({
  answer: z.string().min(1).max(60_000),
  agent_key: KEY.optional(),
});
const SpawnSchema = z.strictObject({
  project: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/),
  template: KEY,
  agents: z
    .array(
      z.strictObject({
        domain: z.string().min(1).max(40),
        name: z.string().min(1).max(80),
        focus: z.string().max(8_000),
      }),
    )
    .max(12),
});

type Env = { timeout?: (req: Request, seconds: number) => void } | undefined;
const ticketOf = (h: string | undefined) => {
  const v = h ?? "";
  const t = v.startsWith("Bearer ") ? v.slice(7).trim() : "";
  if (!t) throw appError("AUTH_EXPIRED");
  return t;
};

export function agentCallRoutes(svc: AgentCallService, spawn: SpawnService) {
  const r = new Hono();
  r.post("/agent-calls", async (c) => {
    const ticket = ticketOf(c.req.header("Authorization"));
    const b = await parseJson(c, CallSchema);
    // Bun `Server.timeout(req, 0)`: tắt idle timeout cho request này (giữ tới khi agent xong; hạn chờ do service kẹp).
    (c.env as Env)?.timeout?.(c.req.raw, 0);
    return c.json(await svc.call(ticket, b));
  });
  r.post("/answers", async (c) => {
    const ticket = ticketOf(c.req.header("Authorization"));
    return c.json(await svc.answer(ticket, await parseJson(c, AnswerSchema)));
  });
  r.get("/waiting", async (c) =>
    c.json({ items: await svc.waiting(ticketOf(c.req.header("Authorization"))) }),
  );
  r.post("/agents/spawn", async (c) => {
    const ticket = ticketOf(c.req.header("Authorization"));
    return c.json(await spawn.spawn(ticket, await parseJson(c, SpawnSchema)));
  });
  return r;
}
