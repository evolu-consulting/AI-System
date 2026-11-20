// CR-195 BR-195-6 · xem tệp văn bản thuần trong trình xem đính kèm: đọc blob từ URL đã có, ≤ 1 MB đầu (cùng `readTextHead` CR-194), chỉ text node trong <pre> ⇒ không có đường XSS.
import { useEffect, useState } from "react";
import { readTextHead } from "../text-head";

export function AttachTextPane({
  url,
  failedText,
  truncatedText,
}: {
  url: string;
  failedText: string;
  truncatedText?: string | undefined;
}) {
  const [r, setR] = useState<{ text: string; truncated: boolean } | "error" | null>(null);
  useEffect(() => {
    let dead = false;
    setR(null);
    fetch(url)
      .then((x) => x.blob())
      .then(readTextHead)
      .then((x) => !dead && setR(x))
      .catch(() => !dead && setR("error"));
    return () => {
      dead = true;
    };
  }, [url]);
  if (r === "error") return <span>{failedText}</span>;
  if (!r) return null;
  return (
    <div
      data-testid="attach-text-viewer"
      style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}
    >
      {r.truncated && truncatedText && (
        <p data-testid="attach-text-truncated" style={{ margin: 0, padding: 8, fontSize: 12 }}>
          {truncatedText}
        </p>
      )}
      <pre
        data-testid="attach-text-content"
        style={{
          margin: 0,
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: 12,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontSize: 13,
          textAlign: "left",
          background: "white",
          color: "#111",
        }}
      >
        {r.text}
      </pre>
    </div>
  );
}
