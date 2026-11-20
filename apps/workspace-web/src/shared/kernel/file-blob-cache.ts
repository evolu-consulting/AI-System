// CR-195 · BR-195-7 · cache byte tệp (Blob) theo id TRONG PHIÊN: mở lại bảng tin / cuộn lại không tải lại ảnh đã có.
// Cache Blob chứ không cache objectURL: bộ hiển thị chung thu hồi URL khi gỡ khỏi màn hình, URL cũ sẽ chết. Mỗi lần dùng tạo URL mới
// từ Blob đã có (rẻ, không mạng). Quyền vẫn do server kiểm ở lần tải đầu; hết phiên (đăng xuất / hết hạn) ⇒ `clearFileBlobs()`.
export const FILE_BLOB_MAX_COUNT = 80;
export const FILE_BLOB_MAX_BYTES = 64 * 1024 * 1024;

const store = new Map<string, Blob>(); // thứ tự chèn = LRU (cũ nhất đứng đầu)
const inflight = new Map<string, Promise<Blob>>();
let bytes = 0;
let gen = 0; // đổi khi xoá cache: tải dở của phiên cũ không được ghi vào phiên mới

function put(id: string, blob: Blob): void {
  if (blob.size > FILE_BLOB_MAX_BYTES) return; // quá lớn: không giữ
  const old = store.get(id);
  if (old) {
    bytes -= old.size;
    store.delete(id);
  }
  store.set(id, blob);
  bytes += blob.size;
  for (const [k, v] of store) {
    if (store.size <= FILE_BLOB_MAX_COUNT && bytes <= FILE_BLOB_MAX_BYTES) break;
    store.delete(k);
    bytes -= v.size;
  }
}

/** Blob của tệp `id`: có sẵn ⇒ trả ngay; đang tải ⇒ dùng chung một lượt; chưa có ⇒ `load()` rồi giữ lại. Lỗi không được giữ. */
export function cachedFileBlob(id: string, load: () => Promise<Blob>): Promise<Blob> {
  const hit = store.get(id);
  if (hit) {
    store.delete(id); // chạm ⇒ chuyển về cuối (mới dùng)
    store.set(id, hit);
    return Promise.resolve(hit);
  }
  const running = inflight.get(id);
  if (running) return running;
  const g = gen;
  const p = load()
    .then((b) => {
      if (g === gen) put(id, b);
      return b;
    })
    .finally(() => {
      if (g === gen) inflight.delete(id);
    });
  inflight.set(id, p);
  return p;
}

/** Hết phiên (đăng xuất / hết hạn): bỏ hết byte tệp đã giữ. */
export function clearFileBlobs(): void {
  gen++;
  store.clear();
  inflight.clear();
  bytes = 0;
}

export const fileBlobStats = () => ({ count: store.size, bytes });
