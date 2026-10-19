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

export function createExtractionAgent(
  transport: AgentTransport,
  nonce: () => string = hexNonce,
): ExtractionAgent {
  return {
    extract: async (req): Promise<AgentReply> => {
      try {
        const { system, prompt } = buildExtractPrompt({
          text: req.text ?? "(The document is the attached file.)",
          nonce: nonce(),
          schema: extractionSchemaText(),
          parent: req.parent,
        });
        const out = await transport({
          who: req.who,
          contractId: req.contractId,
          system,
          prompt,
          file: req.file,
        });
        if (!out.ok) return out;
        const raw = parseExtraction(out.text);
        return raw ? { ok: true, raw } : { ok: false, code: "INVALID_OUTPUT" };
      } catch {
        return { ok: false, code: "AGENT_FAILED" };
      }
    },
  };
}
