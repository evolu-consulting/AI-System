// CR-164 · phần dùng chung của bộ hiển thị tệp đính kèm: icon theo loại, nút nhỏ, tải URL lười. Style nội tuyến + currentColor
// (không phụ thuộc Tailwind của app; màu theo chữ của app).
import {
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { type FileKind, fileKind } from "../attach-layout";

export const mix = (pct: number) => `color-mix(in srgb, currentColor ${pct}%, transparent)`;

export const cardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  maxWidth: "100%",
  padding: "8px 10px",
  border: `1px solid ${mix(18)}`,
  borderRadius: 10,
  background: mix(5),
  fontSize: 13,
};

export const iconBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "4px 8px",
  border: `1px solid ${mix(22)}`,
  borderRadius: 8,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};

/** Nút tròn trên nền tối của hộp phóng to. */
export const navBtn: CSSProperties = {
  ...iconBtn,
  padding: 8,
  color: "white",
  border: 0,
  background: "rgb(255 255 255 / 0.15)",
};

const ICONS: Record<FileKind, typeof File> = {
  pdf: FileText,
  image: FileImage,
  doc: FileText,
  sheet: FileSpreadsheet,
  text: FileText,
  archive: FileArchive,
  other: File,
};

export function KindIcon({ mime, name, size = 22 }: { mime: string; name: string; size?: number }) {
  const kind = fileKind(mime, name);
  const Ic = ICONS[kind];
  return <Ic size={size} aria-hidden="true" data-kind={kind} style={{ flex: "none" }} />;
}

/** CR-173 · màu theo theme sáng/tối có sẵn (token `--primary`, `--danger`; app khác tên ⇒ rơi về `currentColor`). */
export const ACCENT = "var(--primary, currentColor)";
export const DANGER = "var(--danger, var(--destructive, currentColor))";
export const tint = (color: string, pct: number) =>
  `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** Ô vuông chứa biểu tượng loại tệp (thẻ tệp, hàng chọn tệp). */
export function KindTile({ mime, name, size = 36 }: { mime: string; name: string; size?: number }) {
  return (
    <span
      data-testid="kind-tile"
      data-kind={fileKind(mime, name)}
      style={{
        flex: "none",
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        background: tint(ACCENT, 12),
        color: ACCENT,
      }}
    >
      <KindIcon mime={mime} name={name} size={Math.round(size * 0.55)} />
    </span>
  );
}

export const DownloadIcon = Download;
export const SpinIcon = Loader2;

/** URL (blob có xác thực) của một tệp: chỉ tải khi `enabled`; thu hồi blob khi đổi/gỡ. */
export function useLazyUrl(getUrl: (id: string) => Promise<string>, id: string, enabled: boolean) {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  });
  const getRef = useRef(getUrl);
  getRef.current = getUrl;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let made: string | null = null;
    setState({ url: null, failed: false });
    getRef
      .current(id)
      .then((u) => {
        made = u;
        if (alive) setState({ url: u, failed: false });
        else if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      })
      .catch(() => alive && setState({ url: null, failed: true }));
    return () => {
      alive = false;
      if (made?.startsWith("blob:")) URL.revokeObjectURL(made);
    };
  }, [id, enabled]);
  return state;
}

/** "Đã vào khung nhìn" một lần (IntersectionObserver) để tải ảnh lười. */
export function useVisible<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), {
      rootMargin: "200px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return { ref, seen };
}
