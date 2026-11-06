// HD-FR-21 · D2-01 · M3-decouple: `AgentTransport` của lượt trích = lời gọi model TRỰC TIẾP qua AI client chung (không engine,
// không tool, không MCP). Lời nhắc có rào + parse strict + kiểm trích dẫn giữ nguyên ở `extraction-agent.ts`/use case. Ghi usage
// + trần token theo tenant do AI client làm (`hub.usage_logs`, feature `contracts.extract`).
// CR-122 p9 · FLOW2-FR-27: tệp gốc (PDF scan / ảnh JPG-PNG) ⇒ bytes từ FileBox đính kèm lời gọi để model đọc bằng thị giác
// (`attachments`); vắng nguồn bytes hoặc loại tệp khác ⇒ `AGENT_UNAVAILABLE`.
import type { AiAttachment, AiClient, AiFailCode } from "../../../../lib/ai-client/ai-client";
import type { AgentFailCode, SourceFile } from "../application/extraction.ports";
import type { AgentTransport } from "./extraction-agent";
import type { FileContent } from "./source-file-text";

export const EXTRACT_FEATURE = "contracts.extract";
/** Model mặc định (env `CONTRACTS_EXTRACT_MODEL` ghi đè). */
export const EXTRACT_MODEL = "claude-opus-5-5";
/** Loại tệp model đọc được bằng thị giác. */
export const VISION_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const FAIL: Partial<Record<AiFailCode, AgentFailCode>> = {
  CAP_EXCEEDED: "AI_CAP_EXCEEDED",
  UNAVAILABLE: "AGENT_UNAVAILABLE",
};

/** Tệp gốc ⇒ phần đính kèm (không có tệp ⇒ rỗng); không đọc được ⇒ mã lỗi. */
async function attach(
  files: FileContent | undefined,
  file: SourceFile | null,
): Promise<{ ok: true; attachments: AiAttachment[] } | { ok: false; code: AgentFailCode }> {
  if (!file) return { ok: true, attachments: [] };
  if (!files || !VISION_MIME.includes(file.mime)) return { ok: false, code: "AGENT_UNAVAILABLE" };
  const bytes = await files(file.org)
    .getContent(file.fileId)
    .catch(() => null);
  return bytes
    ? { ok: true, attachments: [{ mime: file.mime, bytes }] }
    : { ok: false, code: "SOURCE_UNAVAILABLE" };
}

export function aiTransport(
  client: AiClient,
  o: { model: string; files?: FileContent },
): AgentTransport {
  return async (req) => {
    const a = await attach(o.files, req.file);
    if (!a.ok) return a;
    const out = await client.complete({
      tenantId: req.who.tenantId,
      userId: req.who.userId,
      feature: EXTRACT_FEATURE,
      model: o.model,
      system: req.system,
      prompt: req.prompt,
      signal: req.signal,
      ...(a.attachments.length ? { attachments: a.attachments } : {}),
    });
    if (out.ok) return { ok: true, text: out.text };
    return { ok: false, code: FAIL[out.code] ?? "AGENT_FAILED" };
  };
}
