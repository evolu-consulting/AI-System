// CR-179 · khung ảnh/xem trước KÍCH THƯỚC CỐ ĐỊNH: giữ chỗ ngay lần render đầu, nền tối + vòng xoay tới khi tải xong, ảnh hiện dần (không phình).
// Style nội tuyến (như attach-parts). Fade theo `--duration-fast` (token về 0ms khi người dùng chọn giảm chuyển động).
import { ImageOff } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { ATTACH_SIZE, type AttachLabels, loadPhase } from "../attach-layout";
import { SpinIcon } from "./attach-parts";

const FADE = "opacity var(--duration-fast, 150ms) ease-out";
const SPIN_CSS = "@keyframes attach-frame-spin{to{transform:rotate(360deg)}}";
export const spinStyle: CSSProperties = { animation: "attach-frame-spin 0.9s linear infinite" };

/** Ảnh có khung giữ chỗ: `object-fit` trong khung, `onLoad` mới hiện; lỗi ⇒ ô lỗi cùng kích thước (+ «Tải về» nếu có). */
export function FramedImage({
  url,
  failed,
  alt,
  fit,
  labels,
  imgTestId,
}: {
  url: string | null;
  failed: boolean;
  alt: string;
  fit: "cover" | "contain";
  labels: AttachLabels;
  imgTestId?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: đổi URL ⇒ đặt lại trạng thái tải
  useEffect(() => {
    setLoaded(false);
    setBroken(false);
  }, [url]);
  const phase = loadPhase({ url, failed: failed || broken, loaded });
  return (
    <>
      <style>{SPIN_CSS}</style>
      {url && phase !== "error" && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          data-testid={imgTestId}
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: fit,
            opacity: phase === "ready" ? 1 : 0,
            transition: FADE,
          }}
        />
      )}
      {phase === "loading" && (
        <SpinIcon size={22} aria-hidden="true" style={{ ...spinStyle, opacity: 0.7 }} />
      )}
      {phase === "error" && (
        <span
          data-testid="frame-error"
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
        >
          <ImageOff size={24} aria-label={labels.failed} />
        </span>
      )}
    </>
  );
}

/** Hộp xem trước: kích thước cố định theo khung nhìn, nền đen; «Đang tải…» + vòng xoay ở giữa tới khi nội dung sẵn sàng. */
export function ViewerStage({
  loading,
  loadingText,
  children,
  testId,
}: {
  loading: boolean;
  loadingText: string;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId ?? "viewer-stage"}
      style={{
        position: "relative",
        flex: "none",
        width: ATTACH_SIZE.viewerWidth,
        height: ATTACH_SIZE.viewerHeight,
        maxWidth: "100%",
        maxHeight: "100%",
        background: "black",
        borderRadius: 8,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgb(255 255 255 / 0.75)",
      }}
    >
      <style>{SPIN_CSS}</style>
      {loading ? (
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <SpinIcon size={18} aria-hidden="true" style={spinStyle} /> {loadingText}
        </span>
      ) : (
        children
      )}
    </div>
  );
}
