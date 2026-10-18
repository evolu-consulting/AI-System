// CR-093 Luật 4c · T19-perf vòng 3 · phát câu chuẩn bị sang mọi kết nối của pool. postgres.js lưu câu chuẩn bị THEO KẾT
// NỐI: lần đầu một câu có tham số chạy trên kết nối X ⇒ Parse/Describe rồi mới Bind/Execute (+1 round-trip, lập kế hoạch,
// chặn pipeline). Pool chọn kết nối xoay vòng ⇒ đường nóng (POST Đạt + launch) chỉ nóng hết sau ~`max` lượt. Ở đây: lần
// đầu THẤY một chữ ký câu (kiểu tham số + văn bản), xếp nó vào lô; ngay sau lượt sự kiện hiện tại, lần lượt mượn từng
// kết nối rảnh (`reserve`, mỗi lúc MỘT kết nối ⇒ không giành pool của đường nóng) và chỉ `describe()` (Parse + Describe,
// KHÔNG Bind/Execute ⇒ không chạy câu, an toàn cả INSERT/UPDATE). Tham số gốc chỉ giữ tới khi lô phát xong (để postgres.js
// suy cùng kiểu ⇒ cùng chữ ký bộ nhớ đệm). Lỗi chỉ báo qua `onError`, không ảnh hưởng câu thật.

/** Kết nối mượn của postgres.js (`sql.reserve()`), chỉ phần cần dùng. */
export type SpreadConn = {
  unsafe(q: string, args: unknown[], o: { prepare: true }): { describe(): Promise<unknown> };
  release(): void;
};
export type SpreadPool = { reserve(): Promise<SpreadConn> };
export type StatementSpread = {
  /** Gọi trước mỗi câu `unsafe` có tham số; chữ ký mới ⇒ xếp lô phát. */
  see(text: string, args: readonly unknown[]): void;
  /** Resolve khi không còn lô đang phát (test, tắt máy). */
  idle(): Promise<void>;
  /** Số chữ ký đã thấy. */
  size(): number;
};

/** Trần số chữ ký nhớ (câu SQL văn bản cố định ⇒ vài trăm; vượt trần thì thôi phát, không lỗi). */
export const SPREAD_CAP = 2048;

type Entry = { text: string; args: unknown[] };

/** Mã kiểu postgres.js suy từ giá trị JS (`inferType`): chữ ký bộ nhớ đệm = kiểu + văn bản. */
export function inferredType(x: unknown): number {
  if (x instanceof Date) return 1184;
  if (x instanceof Uint8Array) return 17;
  if (x === true || x === false) return 16;
  if (typeof x === "bigint") return 20;
  if (Array.isArray(x)) return inferredType(x[0]);
  return 0;
}

export function signatureOf(text: string, args: readonly unknown[]): string {
  return `${args.map(inferredType).join(",")}\u0000${text}`;
}

async function describeOn(
  pool: SpreadPool,
  batch: readonly Entry[],
  onError: (e: unknown) => void,
) {
  const c = await pool.reserve();
  try {
    for (const e of batch) {
      try {
        await c.unsafe(e.text, e.args, { prepare: true }).describe();
      } catch (err) {
        onError(err);
      }
    }
  } finally {
    c.release();
  }
}

/** `n` = số kết nối của pool: mỗi lô mượn lần lượt `n` lần (pool trả kết nối rảnh theo FIFO ⇒ lần lượt từng kết nối). */
export function createSpread(
  pool: SpreadPool,
  n: number,
  onError: (e: unknown) => void,
): StatementSpread {
  const seen = new Set<string>();
  let pending: Entry[] = [];
  let running: Promise<void> | null = null;
  const flush = async () => {
    try {
      while (pending.length > 0) {
        const batch = pending;
        pending = [];
        for (let i = 0; i < n; i++) await describeOn(pool, batch, onError);
      }
    } catch (err) {
      pending = [];
      onError(err);
    } finally {
      running = null;
    }
  };
  return {
    see(text, args) {
      if (args.length === 0 || seen.size >= SPREAD_CAP) return;
      const key = signatureOf(text, args);
      if (seen.has(key)) return;
      seen.add(key);
      pending.push({ text, args: [...args] });
      running ??= new Promise<void>((r) => setImmediate(r)).then(flush);
    },
    idle: () => running ?? Promise.resolve(),
    size: () => seen.size,
  };
}
