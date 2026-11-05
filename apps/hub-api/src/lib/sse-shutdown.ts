// HUB-NFR-04 · hub-sse-shutdown: đóng stream SSE khi tắt instance (abort `AppDeps.signal`) mà không làm treo `server.stop`.
// Bun 1.3.14 (Linux, đo evotest 2026-11-05): ≥ 2 response stream bị `controller.close()` CÙNG tick ngay trước
// `server.stop(true)` ⇒ `stop` không bao giờ resolve (1 stream, hoặc đóng ở macrotask sau ⇒ xong ≤ 3 ms, cả `stop(false)`).
// Vì vậy mọi phiên SSE đóng-do-abort ở macrotask SAU: `stop(true)` cắt kết nối trước rồi gọi `cancel()` của stream (phiên dọn
// timer/đăng ký ở đó), lệnh đóng hoãn sau đó vô hại; `stop()` (êm, prod) thì chờ đúng các lệnh đóng hoãn này.

/** Listener `abort` cho một phiên SSE: chạy `close` ở macrotask sau (không cùng tick với `abort()`/`server.stop`). */
export function deferredAbortClose(close: () => void): () => void {
  return () => {
    setTimeout(close, 0);
  };
}
