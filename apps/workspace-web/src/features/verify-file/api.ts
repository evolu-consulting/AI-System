// CR-182 · R7 · `POST /pack/contracts/verify-file` (multipart `file`).
import { api } from "@ai/web-kit/http";

export type VerifyResult =
  | { match: false }
  | {
      match: true;
      which: "original" | "signed";
      contract: { id: string; title: string };
      check_code: string;
      signed_by: string | null;
      signed_at: string | null;
      file_id: string | null;
      seq: number | null;
      version_id: string | null;
    };

export function verifyFile(file: File): Promise<VerifyResult> {
  const form = new FormData();
  form.append("file", file);
  return api<VerifyResult>("/pack/contracts/verify-file", {
    method: "POST",
    rawBody: form as unknown as Blob,
  });
}
