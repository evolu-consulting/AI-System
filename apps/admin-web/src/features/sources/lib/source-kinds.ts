// ADM-FR-68 · thứ tự hiển thị 3 loại nguồn trong bộ lọc / radiogroup (git → thư viện → cục bộ).
import type { SourceKind } from "@ai/contracts/hub-admin";

export const SOURCE_KINDS_UI: readonly SourceKind[] = ["git_remote", "library", "local_path"];
