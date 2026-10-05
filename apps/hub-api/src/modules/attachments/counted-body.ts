// HUB-FR-44 · H2c-R01, R25 · plan §5.1 bước 3 · thân request kèm bộ đếm byte (log `attachment-upload-aborted`) và cờ lỗi
// đọc (client đứt) — dùng chung cho `POST /attachments` và `POST /internal/jobs/:job_id/outputs`.

/** Thân request kèm bộ đếm byte và cờ lỗi đọc. */
export type CountedBody = {
  stream: ReadableStream<Uint8Array>;
  st: { bytes: number; readError: boolean };
  /** Nhả khoá đọc thân gốc (không huỷ) — tầng HTTP còn đọc bỏ phần dư (spec-decisions B1-3, B1-4). */
  release: () => void;
};

export function countedBody(src: ReadableStream<Uint8Array>): CountedBody {
  const reader = src.getReader();
  const st = { bytes: 0, readError: false };
  let released = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(ctl) {
        try {
          const { done, value } = await reader.read();
          if (done) return ctl.close();
          st.bytes += value.length;
          ctl.enqueue(value);
        } catch (e) {
          st.readError = true;
          ctl.error(e);
        }
      },
    },
    { highWaterMark: 0 },
  );
  const release = () => {
    if (released) return;
    released = true;
    try {
      reader.releaseLock();
    } catch {
      // đã nhả / đang đọc dở: tầng HTTP tự bỏ thân
    }
  };
  return { stream, st, release };
}
