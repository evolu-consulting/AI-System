// dlc-dify · lưu trạng thái workspace DLC ra file JSON (dev: một tiến trình): `<dir>/<key>/project.json` (project + queue
// + trạng thái chờ) và `<dir>/tickets.json` (hộp ticket Trello). Ghi qua khoá theo file (đọc-sửa-ghi không xen nhau).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withLock } from "./git";
import type { QueueItem } from "./queue.rules";
import type { TestRun } from "./test-gate.rules";

export type Project = {
  key: string;
  title: string;
  conversation_id: string | null;
  kh_project: string | null;
  stack: string;
  test_command: string | null;
  /** Kết quả test trên `main` tại `sha` (mốc so sánh của cổng merge, xem test-gate.rules). */
  test_baseline?: { sha: string } & TestRun;
  created_at: string;
  queue: QueueItem[];
};

export type Ticket = {
  id: string;
  card_id: string;
  name: string;
  desc: string;
  url: string;
  labels: string[];
  list: string;
  kind: "bug" | "enhancement";
  project_key: string | null;
  status: "new" | "taken" | "done";
  received_at: string;
  updated_at: string;
};

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, v: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(v, null, 2));
}

export class Store {
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
  }
  #pfile = (key: string) => join(this.root, key, "project.json");
  #tfile = () => join(this.root, "tickets.json");

  project(key: string): Project | null {
    return readJson<Project | null>(this.#pfile(key), null);
  }
  projects(): Project[] {
    return readJson<string[]>(join(this.root, "projects.json"), [])
      .map((k) => this.project(k))
      .filter((p): p is Project => !!p);
  }
  async saveProject(p: Project): Promise<void> {
    await withLock(`file:${p.key}`, async () => writeJson(this.#pfile(p.key), p));
    await withLock("file:projects", async () => {
      const f = join(this.root, "projects.json");
      const keys = readJson<string[]>(f, []);
      if (!keys.includes(p.key)) writeJson(f, [...keys, p.key]);
    });
  }
  /** Đọc-sửa-ghi project dưới khoá. */
  async update<T>(
    key: string,
    fn: (p: Project) => { project: Project; value: T },
  ): Promise<T | null> {
    return withLock(`file:${key}`, async () => {
      const p = this.project(key);
      if (!p) return null;
      const r = fn(p);
      writeJson(this.#pfile(key), r.project);
      return r.value;
    });
  }

  tickets(): Ticket[] {
    return readJson<Ticket[]>(this.#tfile(), []);
  }
  async updateTickets<T>(fn: (t: Ticket[]) => { tickets: Ticket[]; value: T }): Promise<T> {
    return withLock("file:tickets", async () => {
      const r = fn(this.tickets());
      writeJson(this.#tfile(), r.tickets);
      return r.value;
    });
  }
}
