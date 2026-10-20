// HUB-FR-129 · P-c2 · mock GitHub (spec §7): REST pulls + GraphQL auto-merge + phản hồi ép + nhật ký gọi.
import { describe, expect, test } from "bun:test";
import { createGithubMock, GH_BAD_CREDENTIALS, GH_MOCK_TOKEN } from "./github";

const AUTH = { authorization: `Bearer ${GH_MOCK_TOKEN}`, "content-type": "application/json" };
const BR = "ai/c0c00000-0000-4000-8000-000000000001/fix";
// biome-ignore lint/suspicious/noExplicitAny: thân JSON của mock trong test
type J = any;

function setup() {
  const g = createGithubMock();
  const req = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = AUTH,
  ) =>
    g.app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { ...g, req };
}

describe("HUB-FR-129 · mock GitHub", () => {
  test("tạo PR 201 (html_url https://github.com/...); tìm theo head=owner:branch; tạo lại ⇒ 422 already exists", async () => {
    const g = setup();
    const create = { title: "t", head: BR, base: "main", body: "b" };
    const r1 = await g.req("POST", "/repos/acme/app/pulls", create);
    expect(r1.status).toBe(201);
    const pr: J = await r1.json();
    expect([pr.number, pr.html_url, pr.head.ref, pr.base.ref]).toEqual([
      1,
      "https://github.com/acme/app/pull/1",
      BR,
      "main",
    ]);
    const list = await g.req("GET", `/repos/acme/app/pulls?head=acme:${BR}&state=open&per_page=1`);
    expect(((await list.json()) as J).map((p: { number: number }) => p.number)).toEqual([1]);
    const r2 = await g.req("POST", "/repos/acme/app/pulls", create);
    expect(r2.status).toBe(422);
    expect(JSON.stringify(await r2.json())).toContain("A pull request already exists");
  });
  test("thiếu/sai token ⇒ 401 Bad credentials; phản hồi ép dùng một lần theo op", async () => {
    const g = setup();
    expect((await g.req("GET", "/repos/acme/app/pulls", undefined, {})).status).toBe(401);
    const bad = await g.req("GET", "/repos/acme/app/pulls", undefined, {
      authorization: "Bearer x",
    });
    expect(await bad.json()).toEqual(GH_BAD_CREDENTIALS);
    g.mock.queue("pulls.list", {
      status: 429,
      headers: { "retry-after": "1" },
      body: { message: "rate" },
    });
    const r = await g.req("GET", "/repos/acme/app/pulls");
    expect([r.status, r.headers.get("retry-after")]).toEqual([429, "1"]);
    expect((await g.req("GET", "/repos/acme/app/pulls")).status).toBe(200);
    expect(g.mock.calls("pulls.list")).toHaveLength(4);
  });
});

describe("HUB-FR-129 · mock GitHub (token, graphql)", () => {
  test("graphql enablePullRequestAutoMerge SQUASH ⇒ auto_merge squash; node lạ ⇒ errors", async () => {
    const g = setup();
    const pr = g.mock.seedPr({ owner: "acme", repo: "app", head: BR, base: "main" });
    const q =
      "mutation($id: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: SQUASH}) { clientMutationId } }";
    const ok: J = await (
      await g.req("POST", "/graphql", { query: q, variables: { id: pr.node_id } })
    ).json();
    expect(ok.data.enablePullRequestAutoMerge.pullRequest.number).toBe(pr.number);
    expect(g.mock.pulls()[0]?.auto_merge).toEqual({ merge_method: "squash" });
    const miss: J = await (
      await g.req("POST", "/graphql", { query: q, variables: { id: "PR_x" } })
    ).json();
    expect(miss.errors?.[0]?.type).toBe("NOT_FOUND");
  });
});
