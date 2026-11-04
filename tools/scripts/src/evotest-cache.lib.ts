// tool-evotest-cache · IO của cache dựng chung: khoá thư mục có nhịp tim (an toàn qua nhiều container dùng chung /cache) và
// "dựng một lần": mọi lượt cùng khoá chờ lượt đầu, thành phẩm vào bằng rename nguyên tử (không ai thấy bản dở).
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { hashExcluded, sha256 } from "./evotest-cache.rules";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type LockOpts = { staleMs?: number; pollMs?: number; timeoutMs?: number };

/** Còn sống = file nhịp tim (hoặc chính thư mục khoá, trong lúc owner chưa kịp ghi) mới hơn `staleMs`. */
function lockAlive(dir: string, staleMs: number, now = Date.now()): boolean {
  try {
    const hb = join(dir, "hb");
    const t = existsSync(hb) ? statSync(hb).mtimeMs : statSync(dir).mtimeMs;
    return now - t < staleMs;
  } catch {
    return false; // vừa bị nhả
  }
}

/**
 * Giữ khoá `dir` (mkdir nguyên tử) trong lúc chạy `fn`. Owner ghi nhịp tim mỗi staleMs/4; khoá có nhịp tim cũ hơn
 * `staleMs` (owner chết/kill -9/container mất) bị gỡ. Chờ tối đa `timeoutMs` (mặc định 20 phút) rồi ném lỗi.
 * `onWait` gọi một lần khi phải chờ lượt khác.
 */
function tryMkdir(dir: string): boolean {
  try {
    mkdirSync(dir);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    return false;
  }
}

async function acquire(dir: string, o: LockOpts & { onWait?: () => void }): Promise<void> {
  const staleMs = o.staleMs ?? 30_000;
  const deadline = Date.now() + (o.timeoutMs ?? 20 * 60_000);
  let said = false;
  while (!tryMkdir(dir)) {
    if (!lockAlive(dir, staleMs)) {
      rmSync(dir, { recursive: true, force: true }); // mồ côi: gỡ rồi thử lại ngay
      continue;
    }
    if (Date.now() > deadline) throw new Error(`chờ khoá quá hạn: ${dir}`);
    if (!said) o.onWait?.();
    said = true;
    await sleep(o.pollMs ?? 250);
  }
}

export async function withDirLock<T>(
  dir: string,
  fn: () => Promise<T>,
  o: LockOpts & { onWait?: () => void } = {},
): Promise<T> {
  const staleMs = o.staleMs ?? 30_000;
  await acquire(dir, o);
  const beat = () => {
    try {
      writeFileSync(join(dir, "hb"), String(Date.now()));
    } catch {}
  };
  beat();
  const timer = setInterval(beat, Math.max(50, staleMs / 4));
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    rmSync(dir, { recursive: true, force: true });
  }
}

export type Ensured = { dir: string; built: boolean; waited: boolean };

/**
 * `<root>/<key>` có sẵn thì dùng (chạm mtime để biết "mới dùng"); chưa có thì đúng MỘT lượt gọi `produce(tmp)` dưới khoá
 * `<root>/.lock-<key>`, các lượt khác chờ rồi dùng bản đó. `produce` điền thư mục tạm; xong ghi `.ref` rồi rename vào `<root>/<key>`.
 */
export async function ensureCached(o: {
  root: string;
  key: string;
  ref: string;
  produce: (tmp: string) => Promise<void>;
  lock?: LockOpts;
}): Promise<Ensured> {
  const final = join(o.root, o.key);
  const ready = () => existsSync(join(final, ".ref"));
  const touch = () => {
    try {
      const t = new Date();
      utimesSync(final, t, t);
    } catch {}
  };
  mkdirSync(o.root, { recursive: true });
  if (ready()) {
    touch();
    return { dir: final, built: false, waited: false };
  }
  let waited = false;
  return withDirLock(
    join(o.root, `.lock-${o.key}`),
    async () => {
      if (ready()) {
        touch();
        return { dir: final, built: false, waited };
      }
      const tmp = join(o.root, `.tmp-${o.key}-${process.pid}-${Date.now().toString(36)}`);
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(tmp);
      try {
        await o.produce(tmp);
        writeFileSync(join(tmp, ".ref"), o.ref);
        rmSync(final, { recursive: true, force: true }); // bản dở cũ không có .ref
        renameSync(tmp, final);
      } catch (e) {
        rmSync(tmp, { recursive: true, force: true });
        throw e;
      }
      return { dir: final, built: true, waited };
    },
    { ...o.lock, onWait: () => (waited = true) },
  );
}

/** Băm nội dung các đường dẫn `paths` (thư mục hoặc file, tương đối `root`) trừ `hashExcluded`; thứ tự ổn định. */
export function hashTree(root: string, paths: readonly string[]): string {
  const files: string[] = [];
  const walk = (rel: string) => {
    if (hashExcluded(rel)) return;
    const abs = join(root, rel);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) for (const n of readdirSync(abs)) walk(rel ? `${rel}/${n}` : n);
    else files.push(rel);
  };
  for (const p of paths) walk(p);
  const h: string[] = [];
  for (const f of files.sort()) h.push(`${f}\0${sha256(readFileSync(join(root, f)))}`);
  return sha256(h.join("\n"));
}

/** Gói workspace: quét `apps/*` và `packages/*` lấy `name` trong package.json. */
export function listWorkspacePkgs(root: string): { dir: string; name: string }[] {
  const out: { dir: string; name: string }[] = [];
  for (const g of ["apps", "packages"]) {
    let names: string[] = [];
    try {
      names = readdirSync(join(root, g));
    } catch {}
    for (const n of names) {
      try {
        const j = JSON.parse(readFileSync(join(root, g, n, "package.json"), "utf8")) as {
          name?: string;
        };
        if (j.name) out.push({ dir: `${g}/${n}`, name: j.name });
      } catch {}
    }
  }
  return out;
}

/** Kích thước (byte) của một thư mục. */
export function dirBytes(dir: string): number {
  let n = 0;
  for (const f of readdirSync(dir, { recursive: true, withFileTypes: true }))
    if (f.isFile()) n += statSync(join(f.parentPath, f.name)).size;
  return n;
}
