// HD-FR-21 · HUB-BR-31 · D2-01: adapter `ExtractionAgent` — dựng lời nhắc có rào (domain `buildExtractPrompt`, nonce ngẫu
// nhiên mỗi lần), gửi qua `AgentTransport` (agent Claude chạy trong Agent Hub; N2/HD3 tiêm transport run Hub), parse đầu ra
// STRICT (`ExtractionOutputSchema`: khoá lạ/kiểu sai ⇒ `INVALID_OUTPUT`, không ghi gì). Không bao giờ ném.
import { ExtractionOutputSchema } from "@ai/contracts";
import { z } from "zod";
import type { PackWho } from "../../kit/application/ports";
import type {
  AgentFailCode,
  AgentReply,
  ExtractionAgent,
  SourceFile,
} from "../application/extraction.ports";
import { buildExtractPrompt } from "../domain/extract-prompt.rules";
import type { RawExtraction } from "../domain/extraction.rules";

/** Đầu ra thô của agent: văn bản (JSON) hoặc mã lỗi. Agent KHÔNG có tool; `file` chỉ khi không có văn bản. */
export type AgentTransport = (req: {
  who: PackWho;
  contractId: string;
  system: string;
  prompt: string;
  file: SourceFile | null;
  /** Huỷ khi hết hạn giờ — transport phải dừng job/run Hub tương ứng. */
  signal: AbortSignal;
}) => Promise<{ ok: true; text: string } | { ok: false; code: AgentFailCode }>;

/** Trần đầu ra đọc (32k token ≈ 200 KB chữ Việt). */
export const AGENT_OUTPUT_MAX = 400_000;
let schemaText: string | null = null;
/** JSON Schema đầu ra (tính một lần) — nằm trong lệnh hệ thống như `extract.py:58`. */
export function extractionSchemaText(): string {
  schemaText ??= JSON.stringify(z.toJSONSchema(ExtractionOutputSchema, { io: "input" }));
  return schemaText;
}

/** Lấy object JSON ngoài cùng (`{` đầu … `}` cuối) rồi parse strict; hỏng ⇒ null. */
export function parseExtraction(text: string): RawExtraction | null {
  if (text.length > AGENT_OUTPUT_MAX) return null;
  const [a, b] = [text.indexOf("{"), text.lastIndexOf("}")];
  if (a < 0 || b <= a) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
  const p = ExtractionOutputSchema.safeParse(raw);
  return p.success ? (p.data as RawExtraction) : null;
}

const hexNonce = (): string => crypto.randomUUID().replace(/-/g, "");

/** Hạn giờ huỷ được: `wait` resolve khi hết giờ; `cancel` gỡ bộ hẹn (test tiêm bản giả — không chờ đồng hồ thật). */
export type Deadline = (ms: number) => { wait: Promise<void>; cancel(): void };
const realDeadline: Deadline = (ms) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<void>((res) => {
    t = setTimeout(res, ms);
  });
  return { wait, cancel: () => clearTimeout(t) };
};

export type ExtractionAgentOptions = {
  nonce?: () => string;
  /** Trần một lượt agent (mặc định 5 phút, env `CONTRACTS_EXTRACT_TIMEOUT_S`); hết ⇒ `TIMEOUT` + huỷ `signal` (review Trung 2). */
  timeoutMs?: number;
  deadline?: Deadline;
};

const TIMEOUT_REPLY: AgentReply = { ok: false, code: "TIMEOUT" };

export function createExtractionAgent(
  transport: AgentTransport,
  o: ExtractionAgentOptions = {},
): ExtractionAgent {
  const nonce = o.nonce ?? hexNonce;
  const timeoutMs = o.timeoutMs ?? 300_000;
  const deadline = o.deadline ?? realDeadline;
  return {
    extract: async (req): Promise<AgentReply> => {
      const ac = new AbortController();
      const dl = deadline(timeoutMs);
      try {
        const { system, prompt } = buildExtractPrompt({
          text: req.text ?? "(The document is the attached file.)",
          nonce: nonce(),
          schema: extractionSchemaText(),
          parent: req.parent,
        });
        const call = transport({
          who: req.who,
          contractId: req.contractId,
          system,
          prompt,
          file: req.file,
          signal: ac.signal,
        });
        const out = await Promise.race([call, dl.wait.then(() => null)]);
        if (out === null) {
          ac.abort();
          return TIMEOUT_REPLY;
        }
        if (!out.ok) return out;
        const raw = parseExtraction(out.text);
        return raw ? { ok: true, raw } : { ok: false, code: "INVALID_OUTPUT" };
      } catch {
        return { ok: false, code: "AGENT_FAILED" };
      } finally {
        dl.cancel();
      }
    },
  };
}
