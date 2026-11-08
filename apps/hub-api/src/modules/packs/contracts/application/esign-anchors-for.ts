// esign-anchor · cụm trong văn bản cho từng người ký (chỉ nhà cung cấp loại "envelope"); không đặt được ⇒ null (trang ký cuối).
// Lỗi đọc chữ không chặn gửi ký. Tách khỏi `esign.usecase.ts` (giới hạn kích thước file).
import type { PackWho } from "../../kit/public";
import type { ESignProvider } from "./esign.ports";
import type { ESignAnchors } from "./esign-anchor.usecase";

export const anchorsForOf =
  (anchors: ESignAnchors | undefined, kindOf: (key: string) => "envelope" | "ca") =>
  async (
    who: PackWho,
    id: string,
    p: ESignProvider,
    doc: { stored: { role: "company" | "partner" }[]; bytes: Uint8Array },
  ): Promise<string[] | null> => {
    const { stored, bytes } = doc;
    if (!anchors || kindOf(p.key) !== "envelope") return null;
    const pick = await anchors
      .pick(
        who,
        id,
        stored.map((s) => s.role),
        bytes,
      )
      .catch(() => null);
    return pick?.mode === "text" ? pick.anchors : null;
  };
