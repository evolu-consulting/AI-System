// dlc-dify · route deploy của project: `POST /projects/:key/deploy {task_ids?}` (không chọn ⇒ HEAD của main, gồm mọi việc
// ready_to_deploy; chọn ⇒ commit merge mới nhất trong các việc đó, kéo theo việc merge trước nó vì main tuần tự),
// `GET /projects/:key/deploys` (lịch sử + việc đang chờ deploy).
import type { Hono } from "hono";
import { z } from "zod";
import type { AppCfg } from "./app";
import { type DeployCfg, type DeployRecord, deployCommit, isAncestor } from "./deploy";
import {
  cfgFromSpec,
  type DeploySpec,
  parsePortRange,
  pickPort,
  publishedPorts,
  staticRootOf,
} from "./deploy-plan.rules";
import { git, mainSha, repoDir } from "./git";
import { body, HttpError, now } from "./http";
import type { QueueItem } from "./queue.rules";
import type { Project, Store } from "./store";

export type DeployDeps = {
  store: Store;
  image: string;
  execMaxS: number;
  proj: (key: string) => Project;
  cfg: AppCfg;
};

/** Cổng host đang publish (mọi container) — tránh đụng app khác trên máy chủ. */
async function dockerPorts(): Promise<number[]> {
  const p = Bun.spawn(["docker", "ps", "--format", "{{.Ports}}"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return publishedPorts(out);
}

/** Cấu hình deploy từ mô tả của spec: giữ cổng đã cấp cho project, chưa có ⇒ cổng trống thấp nhất trong dải. */
export async function allocateDeploy(
  cfg: AppCfg,
  key: string,
  spec: DeploySpec,
): Promise<DeployCfg> {
  const cur = cfg.store.project(key)?.deploy?.port;
  let port = cur ?? null;
  if (!port) {
    const used = [
      ...cfg.store.projects().flatMap((p) => (p.deploy?.port ? [p.deploy.port] : [])),
      ...(await dockerPorts()),
    ];
    port = pickPort(used, cfg.appPorts ?? parsePortRange(undefined));
  }
  if (!port) throw new HttpError(409, "no free app port left in DLC_WS_APP_PORTS");
  return cfgFromSpec(spec, port, cfg.publicHost ?? "localhost");
}

/** Thư mục site tĩnh trên `main` (có index.html), không có ⇒ null. */
async function staticRoot(root: string, key: string): Promise<string | null> {
  const r = await git(repoDir(root, key), ["ls-tree", "-r", "--name-only", "main"]);
  return r.code === 0 ? staticRootOf(r.out.split(/\r?\n/).map((l) => l.trim())) : null;
}

/** Project chưa có cấu hình deploy mà `main` có index.html ⇒ site tĩnh (lưu lại để lần sau giữ cổng). */
async function autoStatic(d: DeployDeps, p: Project): Promise<DeployCfg | null> {
  const root = await staticRoot(d.store.root, p.key);
  if (root === null) return null;
  const deploy = await allocateDeploy(d.cfg, p.key, { kind: "static", root });
  await d.store.update(p.key, (pp) => ({ project: { ...pp, deploy }, value: null }));
  return deploy;
}

/** Commit cần deploy + các việc ready_to_deploy nằm trong commit đó. */
async function pickTarget(root: string, p: Project, ids: string[] | undefined) {
  const repo = repoDir(root, p.key);
  const ready = p.queue.filter((x) => x.status === "ready_to_deploy");
  if (!ids?.length) return { sha: await mainSha(root, p.key), tasks: ready };
  const chosen = ids.map((id) => ready.find((x) => x.id === id));
  const missing = ids.filter((_, i) => !chosen[i]?.sha);
  if (missing.length)
    throw new HttpError(
      400,
      `not ready_to_deploy: ${missing.join(", ")}; ready: ${ready.map((x) => x.id).join(", ") || "none"}`,
    );
  let sha = chosen[0]?.sha as string;
  for (const x of chosen) if (await isAncestor(repo, sha, x?.sha as string)) sha = x?.sha as string;
  const tasks: QueueItem[] = [];
  for (const x of ready) if (x.sha && (await isAncestor(repo, x.sha, sha))) tasks.push(x);
  return { sha, tasks };
}

export function deployRoutes(app: Hono, d: DeployDeps): void {
  const { store, proj } = d;
  app.get("/projects/:key/deploys", async (c) => {
    const p = proj(c.req.param("key"));
    return c.json({
      configured: !!p.deploy || (await staticRoot(store.root, p.key)) !== null,
      url: p.deploy?.url ?? null,
      ready: p.queue
        .filter((x) => x.status === "ready_to_deploy")
        .map((x) => ({ id: x.id, title: x.title, sha: x.sha ?? null })),
      deploys: (p.deploys ?? []).slice(-10),
    });
  });
  app.post("/projects/:key/deploy", async (c) => {
    const cur = proj(c.req.param("key"));
    const b = await body(c, z.object({ task_ids: z.array(z.string().max(80)).max(50).optional() }));
    const auto = cur.deploy ? null : await autoStatic(d, cur);
    const p = auto ? proj(cur.key) : cur;
    if (!p.deploy) throw new HttpError(409, `project ${p.key} has no deploy settings`);
    const { sha, tasks } = await pickTarget(store.root, p, b.task_ids);
    const r = await deployCommit({
      root: store.root,
      key: p.key,
      cfg: p.deploy,
      sha,
      builder: d.image,
      timeoutS: d.execMaxS,
    });
    const ids = tasks.map((x) => x.id);
    const rec: DeployRecord = {
      sha: sha.slice(0, 12),
      at: now(),
      ok: r.ok,
      tasks: ids,
      url: p.deploy.url,
      note: r.output.slice(-1500),
    };
    await store.update(p.key, (pp) => ({
      project: {
        ...pp,
        deploys: [...(pp.deploys ?? []), rec].slice(-50),
        queue: r.ok
          ? pp.queue.map((x) =>
              ids.includes(x.id) ? { ...x, status: "deployed" as const, updated_at: now() } : x,
            )
          : pp.queue,
      },
      value: null,
    }));
    return c.json({ ...rec, output: r.output });
  });
}
