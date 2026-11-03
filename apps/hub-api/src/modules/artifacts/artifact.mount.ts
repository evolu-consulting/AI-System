// CR-114 · hub-agent-handoff · MỘT `ArtifactStore` mỗi `Db` (dùng chung cho `/mcp` và driver Orchestrator). Embedding dùng lại
// stack RAG của gói knowledge (`openAiEmbedder`), chỉ bật khi tenant đã chọn chiến lược embedding (`KNOWLEDGE_STRATEGY`
// bắt đầu bằng `embedding`) và có key — không thêm DB vector, không gọi mạng khi tắt.
import type { Db } from "../../lib/db";
import { openAiEmbedder } from "../knowledge/adapters/ai.adapters";
import { ArtifactMcpTools } from "./artifact.mcp";
import { ArtifactStore } from "./artifact.service";

export { artifactHandoffOn } from "./artifact.flag";

const stores = new WeakMap<Db, ArtifactStore>();

export function artifactStoreFor(
  db: Db,
  env: Record<string, string | undefined> = process.env,
): ArtifactStore {
  let s = stores.get(db);
  if (!s) {
    const embedder = env.KNOWLEDGE_STRATEGY?.startsWith("embedding") ? openAiEmbedder(env) : null;
    s = new ArtifactStore({ db, embedder });
    stores.set(db, s);
  }
  return s;
}

export const artifactMcpTools = (db: Db): ArtifactMcpTools =>
  new ArtifactMcpTools(artifactStoreFor(db));
