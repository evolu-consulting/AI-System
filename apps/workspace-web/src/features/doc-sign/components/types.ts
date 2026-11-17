// CR-181 · kiểu props của màn ký toàn màn hình (s11b). Chưa gọi API: dữ liệu vào bằng props, sự kiện ra bằng callback.
import type { SignatureKind, SignSide } from "@ai/contracts/pack-contracts";
import type { SignItem } from "../lib/sign-items";

export type SignFile = {
  id: string;
  name: string;
  pageCount: number;
  load: () => Promise<ArrayBuffer>;
};
/** Mục trong khay kéo: ảnh chữ ký của tôi, hoặc ô «Chỗ ký» của một người (tím A / cam B). */
export type SignTray =
  | { id: string; type: "mark"; imageUrl: string; aspect: number }
  | { id: string; type: "field"; side: SignSide; person: string };
export type SignKindOption = { kind: SignatureKind; disabledReason?: string };

export type SignWorkspaceProps = {
  files: SignFile[];
  mode: "prep" | "sign";
  items: Record<string, SignItem[]>;
  trays: SignTray[];
  signatureKinds: SignKindOption[];
  kind: SignatureKind;
  onKindChange: (k: SignatureKind) => void;
  onChange: (fileId: string, items: SignItem[]) => void;
  onSave: (fileId: string) => void;
  onClose: () => void;
  /** Bấm ô «Bấm để ký» của mình. */
  onFieldClick?: (fileId: string, itemId: string) => void;
  saveLabel: string;
  dirty: boolean;
};
