"""Tests for the switchable external embedder (app/embeddings/remote.py, app/embed_server.py), 2026-10-11.

WHAT IS UNDER TEST
  1. MODES. KH_EMBEDDER local returns the in-process adapter (unchanged), remote the service adapter,
     auto the service with a local fallback; a bad mode or remote without a URL is refused.
  2. DROP-IN. The remote adapter returns the same shapes as SentenceTransformer.encode (str -> 1-D, list ->
     2-D, float32), honours normalize, and keeps the query/passage asymmetry (the SERVICE prepends the query
     instruction for encode_query only).
  3. HANDSHAKE. A service running another model or dimension is refused; a service that is down does not
     stop KH in remote mode, and the route then answers 503 embedder_unavailable.
  4. AUTO. The first failure loads the local model and answers locally; after N failures the breaker stays
     local for M seconds, then probes the service again.
  5. SERVICE. Token required (401), request limits, text cut at max_chars, client-side batch split, and
     MICRO-BATCHING: concurrent requests share forward passes.
  6. LIVE (real bge-small): vectors from the service equal the local ones (cosine > 0.9999), and the
     throughput of 32 concurrent short queries, local sequential vs service micro-batched.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_embed_remote.py
Network: localhost only (an in-process service on a free port).
"""
import os
import socket
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_embed_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
os.environ.pop("KH_AUTH_ISSUER", None)
os.environ.pop("KH_EMBEDDER", None)

import numpy as np                                        # noqa: E402
import uvicorn                                            # noqa: E402

from app import config                                   # noqa: E402
from app.embed_server import create_app                   # noqa: E402
from app.embeddings import get_embedder                   # noqa: E402
from app.embeddings.remote import (AutoEmbeddingAdapter, EmbedderMismatch,  # noqa: E402
                                   EmbedderUnavailable, RemoteEmbeddingAdapter)
from app.embeddings.sentence_transformer_adapter import SentenceTransformerAdapter  # noqa: E402

FAILED = []


def check(name, cond, detail=""):
    print("%-4s %s%s" % ("ok" if cond else "FAIL", name, ("  <- " + str(detail)) if detail and not cond else ""))
    if not cond:
        FAILED.append(name)


def raises(fn, exc):
    try:
        fn()
    except exc:
        return True
    except Exception as e:   # noqa: BLE001
        print("     raised", type(e).__name__, e)
        return False
    return False


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Server:
    """A uvicorn server in a thread, for an app built by create_app."""

    def __init__(self, app):
        self.port = free_port()
        self.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="error"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        for _ in range(200):
            if self.server.started:
                break
            time.sleep(0.05)
        self.url = "http://127.0.0.1:%d" % self.port

    def stop(self):
        self.server.should_exit = True
        self.thread.join(10)


class Fake:
    """A deterministic stand-in for the model; records what it was asked."""

    name = "bge-small-en-v1.5"
    dim = 4
    query_instruction = "Q: "

    def __init__(self):
        self.calls, self.seen, self.normalize, self.lock = 0, [], [], threading.Lock()

    def vec(self, t):
        h = sum(ord(c) for c in t) % 97 + 1
        v = np.array([h, len(t) % 13 + 1, 1.0, 2.0], dtype=np.float32)
        return v

    def encode(self, sentences, normalize_embeddings=True, **kw):
        with self.lock:
            self.calls += 1
            self.normalize.append(normalize_embeddings)
            single = isinstance(sentences, str)
            texts = [sentences] if single else list(sentences)
            self.seen.extend(texts)
        time.sleep(0.01)                                  # a forward pass costs time
        arr = np.stack([self.vec(t) for t in texts])
        if normalize_embeddings:
            arr = arr / np.linalg.norm(arr, axis=1, keepdims=True)
        return arr[0] if single else arr

    def load(self):
        return self


# 1. modes ------------------------------------------------------------------------------------------
check("local mode -> in-process adapter (unchanged)", isinstance(get_embedder(mode="local"), SentenceTransformerAdapter))
config.EMBED_URL = "http://127.0.0.1:1"
check("remote mode -> RemoteEmbeddingAdapter", isinstance(get_embedder(mode="remote"), RemoteEmbeddingAdapter))
check("auto mode -> AutoEmbeddingAdapter", isinstance(get_embedder(mode="auto"), AutoEmbeddingAdapter))
check("remote adapter expects the registered dim", get_embedder(mode="remote").dim == 384)
check("unknown mode refused", raises(lambda: get_embedder(mode="gpu"), ValueError))
config.EMBED_URL = ""
check("remote without KH_EMBED_URL refused", raises(lambda: get_embedder(mode="remote"), ValueError))
check("repr never shows the token", "s3cret" not in repr(RemoteEmbeddingAdapter("http://x", "s3cret")))

# 2-5. against a service with a fake model -----------------------------------------------------------
fake = Fake()
srv = Server(create_app(fake, token="tok", window_ms=30, max_batch=64, max_texts=5, max_chars=50))
try:
    r = RemoteEmbeddingAdapter(srv.url, "tok", name="bge-small-en-v1.5", dim=4, retries=0).load(strict=True)
    check("handshake ok", r.dim == 4 and r.info.get("model") == "bge-small-en-v1.5")
    one = r.encode("hello world")
    many = r.encode(["a", "bb"])
    check("str -> 1-D float32 like SentenceTransformer", one.shape == (4,) and one.dtype == np.float32, one.shape)
    check("list -> 2-D", many.shape == (2, 4), many.shape)
    check("same vector as the model", np.allclose(one, fake.encode("hello world")))
    raw = r.encode("xyz", normalize_embeddings=False)
    check("normalize flag honoured", not np.isclose(np.linalg.norm(raw), 1.0) and fake.normalize.count(False) >= 1)
    check("extra encode kwargs accepted", r.encode(["k"], batch_size=64, show_progress_bar=False).shape == (1, 4))
    fake.seen.clear()
    r.encode("doc text")
    q = r.encode_query("find this")
    check("passage sent as is", "doc text" in fake.seen)
    check("query gets the instruction from the SERVICE", "Q: find this" in fake.seen and isinstance(q, list))
    check("empty list -> (0, dim)", r.encode([]).shape == (0, 4))

    # token
    import requests
    check("no token -> 401", requests.post(srv.url + "/embed", json={"texts": ["a"]}).status_code == 401)
    check("info needs the token", requests.get(srv.url + "/embed/info").status_code == 401)
    check("health is open", requests.get(srv.url + "/health").status_code == 200)
    bad = RemoteEmbeddingAdapter(srv.url, "wrong", name="bge-small-en-v1.5", dim=4, retries=0)
    check("wrong token -> EmbedderUnavailable", raises(lambda: bad.load(strict=True), EmbedderUnavailable))

    # handshake mismatch
    check("other model refused", raises(
        lambda: RemoteEmbeddingAdapter(srv.url, "tok", name="other-model", dim=4).load(), EmbedderMismatch))
    check("other dim refused", raises(
        lambda: RemoteEmbeddingAdapter(srv.url, "tok", name="bge-small-en-v1.5", dim=384).load(), EmbedderMismatch))

    # limits
    resp = requests.post(srv.url + "/embed", json={"texts": ["a"] * 6}, headers={"Authorization": "Bearer tok"})
    check("too many texts -> 413", resp.status_code == 413, resp.status_code)
    fake.seen.clear()
    r.encode("z" * 200)
    check("text cut at max_chars", fake.seen and len(fake.seen[0]) == 50, [len(x) for x in fake.seen])
    resp = requests.post(srv.url + "/embed", json={"texts": "nope"}, headers={"Authorization": "Bearer tok"})
    check("bad body -> 400", resp.status_code == 400)

    # client-side batch split
    count = {"n": 0}

    def counting_session():
        s = requests.Session()
        orig = s.request

        def req(method, url, **kw):
            if url.endswith("/embed"):
                count["n"] += 1
            return orig(method, url, **kw)
        s.request = req
        return s
    rb = RemoteEmbeddingAdapter(srv.url, "tok", name="bge-small-en-v1.5", dim=4, batch_max=3,
                                session_factory=counting_session).load()
    out = rb.encode(["t%d" % i for i in range(7)])
    check("7 texts with batch_max 3 -> 3 requests, 7 vectors", count["n"] == 3 and out.shape == (7, 4), count)

    # micro-batching: 16 concurrent single-text requests share forward passes
    fake.calls = 0
    rr = RemoteEmbeddingAdapter(srv.url, "tok", name="bge-small-en-v1.5", dim=4).load()
    res = [None] * 16
    ths = [threading.Thread(target=lambda i=i: res.__setitem__(i, rr.encode("concurrent %d" % i))) for i in range(16)]
    [t.start() for t in ths]
    [t.join() for t in ths]
    passes = fake.calls
    print("     forward passes for 16 concurrent requests: %d" % passes)
    check("16 concurrent requests -> fewer forward passes", 0 < passes < 16, passes)
    check("each caller got its own vector", all(np.allclose(res[i], fake.encode("concurrent %d" % i)) for i in range(16)))

    # 4. auto: fallback + breaker
    clock = {"t": 0.0}
    local_fake = Fake()
    loads = {"n": 0}

    def local_factory():
        loads["n"] += 1
        return local_fake
    dead = RemoteEmbeddingAdapter("http://127.0.0.1:%d" % free_port(), "tok", name="bge-small-en-v1.5", dim=4,
                                  retries=0, timeout_s=1)
    auto = AutoEmbeddingAdapter(dead, local_factory, fail_threshold=2, cooldown_s=30, clock=lambda: clock["t"])
    check("auto: local not loaded before a failure", not auto.local_loaded)
    v = auto.encode("x")
    check("auto: first failure answers locally", v.shape == (4,) and auto.local_loaded and loads["n"] == 1)
    auto.encode("y")
    check("auto: breaker opens after 2 failures", auto.open_until == 30.0 and auto.failures == 2)
    dead_calls = {"n": 0}
    orig_call = dead._call
    dead._call = lambda *a, **k: (dead_calls.__setitem__("n", dead_calls["n"] + 1), orig_call(*a, **k))[1]
    auto.encode("z")
    check("auto: while open, the service is not tried", dead_calls["n"] == 0)
    good = RemoteEmbeddingAdapter(srv.url, "tok", name="bge-small-en-v1.5", dim=4).load()
    auto.remote = good
    clock["t"] = 31.0
    auto.encode("probe")
    check("auto: after the cooldown it probes and closes again", auto.failures == 0 and auto.open_until == 0.0)
    check("auto: model loaded only once", loads["n"] == 1)
    check("auto: mismatch still refused at startup", raises(lambda: AutoEmbeddingAdapter(
        RemoteEmbeddingAdapter(srv.url, "tok", name="other", dim=4), local_factory).load(), EmbedderMismatch))
finally:
    srv.stop()

# 3. remote mode, service down: KH starts and the route answers 503 ---------------------------------
down = RemoteEmbeddingAdapter("http://127.0.0.1:%d" % free_port(), "tok", name="bge-small-en-v1.5", dim=384,
                              retries=0, timeout_s=1)
check("remote mode: a down service does not stop startup", down.load() is down)
check("remote mode: encode raises EmbedderUnavailable", raises(lambda: down.encode("x"), EmbedderUnavailable))
from fastapi.testclient import TestClient                  # noqa: E402
import main                                                # noqa: E402
main.app.state.model = down
client = TestClient(main.app)
resp = client.post("/vector/query", json={"text": "anything", "scope": "knowledge", "project": "alpha", "k": 3})
check("remote mode down -> 503 embedder_unavailable", resp.status_code == 503
      and resp.json().get("error") == "embedder_unavailable", (resp.status_code, resp.text[:200]))

# 6. live: real model through the service --------------------------------------------------------------
if os.environ.get("KH_EMBED_LIVE", "1") == "1" and os.path.isdir(os.path.join(ROOT, "models", "bge-small-en-v1.5")):
    from app.embeddings import get_local_embedder
    local = get_local_embedder().load()
    srv = Server(create_app(local, token="tok"))
    try:
        rem = RemoteEmbeddingAdapter(srv.url, "tok", name=local.name, dim=local.dim).load(strict=True)
        texts = ["deploy KH to BTP", "the penguin mascot", "rollback the release", "HANA pool size", "xin chao"]
        a, b = local.encode(texts, normalize_embeddings=True, show_progress_bar=False), rem.encode(texts)
        cos = [float(np.dot(a[i], b[i])) for i in range(len(texts))]
        check("live: service vectors == local (cosine > 0.9999)", min(cos) > 0.9999, cos)
        qa, qb = local.encode_query("how do I deploy"), rem.encode_query("how do I deploy")
        check("live: query vectors == local encode_query", float(np.dot(qa, qb)) > 0.9999)

        qs = ["short query number %d about deploys" % i for i in range(32)]
        t0 = time.perf_counter()
        for q in qs:
            local.encode(q, normalize_embeddings=True, show_progress_bar=False)
        seq = time.perf_counter() - t0
        out = [None] * 32
        t0 = time.perf_counter()
        ths = [threading.Thread(target=lambda i=i: out.__setitem__(i, rem.encode(qs[i]))) for i in range(32)]
        [t.start() for t in ths]
        [t.join() for t in ths]
        par = time.perf_counter() - t0
        print("     32 short queries: local sequential %.0f ms, service micro-batched %.0f ms (x%.1f)"
              % (seq * 1000, par * 1000, seq / par if par else 0))
        check("live: micro-batched service not slower than sequential local", par <= seq * 1.2, (seq, par))
    finally:
        srv.stop()

print("ALL PASS" if not FAILED else "FAILED: %s" % FAILED)
sys.exit(1 if FAILED else 0)
