// CR-173 · MỘT cách chọn/đính tệp cho cả hệ thống (mở rộng bộ CR-164): vùng kéo-thả (`AttachDropzone`, đủ + gọn) và nút kẹp giấy
// (`AttachPickButton`) cho ô soạn. Chỉ lo CHỌN + kiểm loại/cỡ/số lượng; tệp đã chọn vẽ bằng `AttachDraftList`.
// Style nội tuyến + token (`--primary`, `--danger`, `currentColor`): không phụ thuộc Tailwind của app.
import { Paperclip, UploadCloud } from "lucide-react";
import { type CSSProperties, type DragEvent, type RefObject, useId, useRef, useState } from "react";
import {
  type AttachPickLabels,
  acceptTypesLabel,
  formatBytes,
  type PickRule,
  rejectText,
  validateFiles,
} from "../attach-layout";
import { ACCENT, DANGER, iconBtn, mix, tint } from "./attach-parts";

type PickProps = PickRule & {
  labels: AttachPickLabels;
  /** Tệp đã qua kiểm tra. Không bao giờ gọi với mảng rỗng. */
  onFiles: (files: File[]) => void;
  /** Có tệp bị từ chối ⇒ câu lỗi (vùng kéo-thả tự hiện lỗi tại chỗ; nút gọn dùng cái này). */
  onReject?: (messages: string[]) => void;
  /** Số tệp đã chọn (tính vào `maxFiles`). */
  current?: number;
  multiple?: boolean;
  disabled?: boolean;
  locale?: string;
  /** `data-testid` của ô `input[type=file]` ẩn (giữ testid cũ của màn). */
  inputTestId?: string;
  inputId?: string;
  /** false ⇒ chỉ đặt `accept` cho hộp chọn tệp của trình duyệt, KHÔNG kiểm (app đã có luật + câu lỗi riêng). */
  check?: boolean;
};

function usePick(p: PickProps, setErrors?: (m: string[]) => void) {
  const rule: PickRule =
    p.check === false ? {} : { accept: p.accept, maxBytes: p.maxBytes, maxFiles: p.maxFiles };
  return (list: FileList | File[] | null) => {
    let files = Array.from(list ?? []);
    if (files.length === 0) return;
    const single = p.multiple === false;
    if (single) files = files.slice(0, 1);
    const { ok, rejects } = validateFiles(files, rule, single ? 0 : (p.current ?? 0));
    const msgs = rejects.map((r) => rejectText(r, p.labels, rule, p.locale));
    setErrors?.(msgs);
    if (msgs.length) p.onReject?.(msgs);
    if (ok.length) p.onFiles(ok);
  };
}

function HiddenInput({
  p,
  inputRef,
  take,
}: {
  p: PickProps;
  inputRef: RefObject<HTMLInputElement | null>;
  take: (l: FileList | null) => void;
}) {
  return (
    <input
      ref={inputRef}
      id={p.inputId}
      type="file"
      hidden
      multiple={p.multiple !== false}
      accept={p.accept}
      disabled={p.disabled}
      data-testid={p.inputTestId}
      onChange={(e) => {
        take(e.target.files);
        e.target.value = "";
      }}
    />
  );
}

export type DropzoneProps = PickProps & {
  /** `compact` = một hàng (trong thẻ/hộp thoại hẹp). */
  variant?: "full" | "compact";
  /** Đang tải lên: vùng mờ, không nhận thêm. */
  busy?: boolean;
  /** Lỗi từ app (vd máy chủ từ chối) hiện cùng chỗ với lỗi loại/cỡ. */
  error?: string | undefined;
  /** Đè dòng gợi ý (mặc định: «Hỗ trợ PDF, DOCX · tối đa 20 MB mỗi tệp»). */
  hint?: string;
  /** `data-testid` của nút «Chọn tệp» (giữ testid cũ của nút thêm tệp). */
  chooseTestId?: string;
};

function boxStyle(compact: boolean, over: boolean, off: boolean | undefined): CSSProperties {
  return {
    display: "flex",
    flexDirection: compact ? "row" : "column",
    alignItems: "center",
    justifyContent: "center",
    gap: compact ? 10 : 6,
    padding: compact ? "8px 12px" : "20px 16px",
    textAlign: compact ? "left" : "center",
    border: `1.5px dashed ${over ? ACCENT : mix(35)}`,
    borderRadius: 12,
    background: over ? tint(ACCENT, 10) : mix(4),
    color: "inherit",
    fontSize: 13,
    opacity: off ? 0.6 : 1,
    transition: "border-color .15s, background .15s",
  };
}

// CR-180 luật 1: điện thoại ⇒ «Chọn tệp» cao ≥ 44px (style nội tuyến không có media query).
const CHOOSE_CSS =
  "@media(max-width:640px){.ai-attach__choose{min-height:44px;min-width:44px;padding:0 4px!important}}";

const chooseStyle: CSSProperties = {
  border: 0,
  background: "none",
  padding: 0,
  font: "inherit",
  fontWeight: 600,
  color: ACCENT,
  textDecoration: "underline",
};

/** «Kéo thả tệp vào đây hoặc **Chọn tệp**» + dòng gợi ý; đang rê ⇒ đổi câu (nút giữ chỗ để không nhảy bố cục). */
function ChooseLine(p: {
  labels: AttachPickLabels;
  over: boolean;
  off: boolean | undefined;
  line: string;
  hintId: string;
  testId: string;
  onChoose: () => void;
}) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <style>{CHOOSE_CSS}</style>
      <span>
        {p.over ? <b>{p.labels.dropActive}</b> : <>{p.labels.drop} </>}
        <button
          type="button"
          data-testid={p.testId}
          className="ai-attach__choose"
          disabled={p.off}
          aria-describedby={p.line ? p.hintId : undefined}
          onClick={p.onChoose}
          style={{
            ...chooseStyle,
            cursor: p.off ? "default" : "pointer",
            visibility: p.over ? "hidden" : "visible",
          }}
        >
          {p.labels.choose}
        </button>
      </span>
      {p.line && (
        <span id={p.hintId} style={{ opacity: 0.7, fontSize: 12 }}>
          {p.line}
        </span>
      )}
    </span>
  );
}

function ErrorList({ errs }: { errs: string[] }) {
  if (errs.length === 0) return null;
  return (
    <ul
      role="alert"
      data-testid="attach-errors"
      style={{ margin: 0, padding: 0, listStyle: "none", color: DANGER, fontSize: 12 }}
    >
      {errs.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}

/** Trạng thái rê tệp + bốn sự kiện kéo-thả của vùng (khoá khi `off`). */
function useDrag(off: boolean | undefined, take: (l: FileList | null) => void) {
  const [over, setOver] = useState(false);
  const stop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const enter = (e: DragEvent) => {
    stop(e);
    if (!off) setOver(true);
  };
  return {
    over,
    handlers: {
      onDragEnter: enter,
      onDragOver: enter,
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        stop(e);
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        stop(e);
        setOver(false);
        if (!off) take(e.dataTransfer.files);
      },
    },
  };
}

function hintLine(p: DropzoneProps): string {
  const types = acceptTypesLabel(p.accept, p.labels.image);
  if (p.hint) return p.hint;
  if (!types && p.maxBytes === undefined) return "";
  return p.labels.hint(types, p.maxBytes === undefined ? "" : formatBytes(p.maxBytes, p.locale));
}

export function AttachDropzone(props: DropzoneProps) {
  const { labels, variant = "full", busy, disabled, error } = props;
  const [errors, setErrors] = useState<string[]>([]);
  const ref = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const off = disabled || busy;
  const take = usePick(props, setErrors);
  const { over, handlers } = useDrag(off, take);
  const line = hintLine(props);
  const compact = variant === "compact";
  const errs = [...errors, ...(error ? [error] : [])];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <section
        data-testid="attach-dropzone"
        data-active={over || undefined}
        data-variant={variant}
        data-disabled={off || undefined}
        aria-label={labels.attach}
        {...handlers}
        style={boxStyle(compact, over, off)}
      >
        <UploadCloud
          size={compact ? 20 : 28}
          aria-hidden="true"
          style={{ flex: "none", color: over ? ACCENT : "inherit", opacity: over ? 1 : 0.7 }}
        />
        <ChooseLine
          labels={labels}
          over={over}
          off={off}
          line={line}
          hintId={hintId}
          testId={props.chooseTestId ?? "attach-choose"}
          onChoose={() => ref.current?.click()}
        />
        <HiddenInput p={{ ...props, disabled: off }} inputRef={ref} take={take} />
      </section>
      <ErrorList errs={errs} />
    </div>
  );
}

/** Bản gọn cho ô soạn: nút icon kẹp giấy + ô chọn tệp ẩn. Lỗi trả qua `onReject` (ô soạn có chỗ báo riêng). */
export function AttachPickButton(
  props: PickProps & { style?: CSSProperties; className?: string; testId?: string },
) {
  const ref = useRef<HTMLInputElement>(null);
  const take = usePick(props);
  return (
    <>
      <HiddenInput p={props} inputRef={ref} take={take} />
      <button
        type="button"
        data-testid={props.testId ?? "attach-btn"}
        className={props.className}
        aria-label={props.labels.attach}
        title={props.labels.attach}
        disabled={props.disabled}
        onClick={() => ref.current?.click()}
        style={
          props.className ? props.style : { ...iconBtn, padding: 6, border: 0, ...props.style }
        }
      >
        <Paperclip size={17} aria-hidden="true" />
      </button>
    </>
  );
}
