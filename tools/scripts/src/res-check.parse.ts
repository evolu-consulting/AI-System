// res-check · bộ phân tích đầu ra PowerShell (local, Windows) và ssh (máy chủ evotest) — thuần, có test mẫu.
import type { ServerMetrics } from "./res-check.rules";

export type RawLocal = {
  cores: number;
  /** % CPU 0..100 */
  cpuPct: number;
  freeRamMb: number;
  totalRamMb: number;
  freeDiskGb: number;
  procs: { name: string; cmd: string }[];
};

/** Script PowerShell MỘT lần gọi; `{DRIVE}` thay bằng chữ ổ đĩa của repo. Xuất một dòng JSON. */
export const PS_LOCAL_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$d = Get-PSDrive -Name {DRIVE} -ErrorAction SilentlyContinue
$procs = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(postgres|node|bun|chrome|chromium|msedge|headless_shell|chrome-headless-shell)(\\.exe)?$' } | ForEach-Object { @{ n = $_.Name; c = [string]$_.CommandLine } })
@{ cores = [int]$cs.NumberOfLogicalProcessors; cpu = [double]$cpu; freeKb = [double]$os.FreePhysicalMemory; totalKb = [double]$os.TotalVisibleMemorySize; disk = [double]$d.Free; procs = $procs } | ConvertTo-Json -Compress -Depth 4
`;

export function parseLocalPs(text: string): RawLocal | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  try {
    const j = JSON.parse(text.slice(start)) as {
      cores: number;
      cpu: number;
      freeKb: number;
      totalKb: number;
      disk: number;
      procs: { n: string; c: string } | { n: string; c: string }[] | null;
    };
    if (!j.cores || !j.totalKb) return undefined;
    const rows = j.procs == null ? [] : Array.isArray(j.procs) ? j.procs : [j.procs];
    return {
      cores: j.cores,
      cpuPct: Number.isFinite(j.cpu) ? j.cpu : 0,
      freeRamMb: j.freeKb / 1024,
      totalRamMb: j.totalKb / 1024,
      freeDiskGb: (j.disk || 0) / 1024 ** 3,
      procs: rows.map((r) => ({ name: r.n ?? "", cmd: r.c ?? "" })),
    };
  } catch {
    return undefined;
  }
}

/** Script chạy TRÊN máy chủ (đưa qua stdin cho `bash -s`; chỉ lệnh đọc). Xuất `khoá=giá trị`. */
export const serverScript = (slots: number): string => `
echo "nproc=$(nproc)"
echo "load1=$(cut -d' ' -f1 /proc/loadavg)"
echo "mem_avail_kb=$(awk '/MemAvailable/{print $2}' /proc/meminfo)"
echo "mem_total_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo)"
echo "disk_free_kb=$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
echo "containers=$(docker ps -q 2>/dev/null | wc -l)"
for i in $(seq 1 ${slots}); do
  if [ "$i" = 1 ]; then l="$HOME/workspace/evotest/.lock"; else l="$HOME/workspace/evotest/slots/s$i/.lock"; fi
  if [ -d "$l" ]; then echo "slot$i=busy"; else echo "slot$i=free"; fi
done
`;

export function parseServerOut(text: string): ServerMetrics | undefined {
  const kv = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([a-z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) kv.set(m[1] as string, (m[2] as string).trim());
  }
  const num = (k: string): number | undefined => {
    const v = kv.get(k);
    return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
  };
  const cores = num("nproc");
  const load1 = num("load1");
  const avail = num("mem_avail_kb");
  const total = num("mem_total_kb");
  const disk = num("disk_free_kb");
  if (!cores || load1 === undefined || avail === undefined || !total || disk === undefined)
    return undefined;
  const slots = [...kv.keys()]
    .map((k) => /^slot(\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => kv.get(m[0]) === "busy");
  return {
    cores,
    load1,
    freeRamMb: avail / 1024,
    totalRamMb: total / 1024,
    freeDiskGb: disk / 1024 ** 2,
    containers: num("containers") ?? 0,
    slotsBusy: slots,
  };
}

/** `git worktree list --porcelain` → [{path, branch?}] (branch bỏ `refs/heads/`). */
export function parseWorktreeList(text: string): { path: string; branch?: string }[] {
  const out: { path: string; branch?: string }[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const p = /^worktree (.+)$/m.exec(block);
    if (!p) continue;
    const b = /^branch refs\/heads\/(.+)$/m.exec(block);
    out.push({ path: (p[1] as string).trim(), ...(b ? { branch: (b[1] as string).trim() } : {}) });
  }
  return out;
}
