# The hot log window

*Current state as of 2026-08-29. History of the change is in
`change_log/2026_08_29_hot_log_window.md`.*

## What problem it solves

Worklogs are physically isolated per project: a log tagged `project=ticketing-system`
lives in the Chroma collection `kh_log_ticketing-system`, nowhere else. That isolation
is good for storage and bad for recall — a question about recent work could only be
answered after the project was resolved, so every question had to start by naming one,
and a question spanning projects meant reading every partition.

The hot log window puts one small shared partition **in front of** the per-project logs.

## How a write works

`POST /vector/add` with `scope=log` no longer writes to `kh_log_<project>`. It writes to
`kh_hotlog`, keeping `metadata.project` as the tag that says who owns the row. A log
that arrives with no project is tagged `orchestrator` rather than left untagged, so no
row can become unattributable later.

Every other scope is untouched: `knowledge`, `findings` and custom parts still go
straight to their own project collection.

## What the window holds

**Slots, not rows.** One slot per project. A slot holds *all* of that project's recent
entries, which is what keeps several days of work answerable rather than the last
handful of lines.

The capacity is `HOTLOG_SLOTS`, defaulting to `MAX_OPEN_PROJECT_GRAPHS` (6). This is
deliberate, not a coincidence: that is already the number of project graphs KH keeps
open, so a project that is hot in the graph cache is hot in the log window. Both evict
least-recently-used, so the two windows move together instead of drifting apart.

Three bounds apply, in this order, all env-tunable:

| Bound | Setting | Default | What it does |
|---|---|---|---|
| Age | `KH_HOTLOG_MAX_AGE_DAYS` | 14 | entries older than this leave, whatever slot |
| Depth | `KH_HOTLOG_MAX_PER_SLOT` | 50 | a slot keeps at most this many, newest kept |
| Slots | `KH_HOTLOG_SLOTS` | `KH_MAX_OPEN_PROJECTS` (6) | least-recently-used slot spills whole |

Without the first two, a project worked on for weeks would grow one slot without limit
and the window would stop being small, which is the only property that makes it fast.

## Eviction never loses a row

Evicting means **spill**, not drop: the row is copied into `kh_log_<project>` with its
existing embedding (no re-encoding), and only then deleted from the window. The order
matters — a crash between the two steps leaves a duplicate that the next pass
overwrites by id, whereas deleting first would lose the row outright.

So `kh_log_<project>` remains the system of record. The window is a cache.

## How a read works

Every read of `scope=log` covers **both** places. `main.py::_read_lanes` builds one
lane per physical collection plus a window lane; when a project is named, the window
lane is narrowed to that project so the shared partition cannot leak another project's
work into a scoped read. This applies to `/vector/scroll`, `/vector/topics` and the
semantic `/vector/query` path alike.

The consequence worth stating plainly: **a caller cannot tell whether a row is still
hot or already spilled**, and does not need to. That is what allowed the window to be
added without changing any existing read.

### `GET /log/recent`

Answers "what happened lately?" with no project named. Reads the window alone, sorts by
`metadata.ts` descending, and reports the owning project on every row so the answer can
still say *where* the work happened.

| Param | Meaning |
|---|---|
| `limit` | how many rows (default 50) |
| `project` | narrow to one project |
| `since` | ISO-8601 UTC or epoch seconds; keep entries at or after it |
| `topic` | narrow to one subject (since 2026-09-30) |
| `max_chars` | return snippets of this length; `truncated` and `text_len` mark a clipped row (since 2026-09-30) |

**With `project` named** (since 2026-09-30) it reads the project's whole log - the window and every
row already spilled into `kh_log_<project>` - sorted newest first on the server. "The latest entry
on X" is `GET /log/recent?project=<id>&topic=<X>&limit=1`, whatever the size of the partition.
Without a project it reads the window alone, as before.

`/vector/scroll` takes the same idea: `order` (`newest`/`oldest`) and `since` sort and filter by
`metadata.ts` on the server before paging, `ids` fetches exact rows (the full text of a snippet),
and `max_chars` returns snippets. `/vector/query` takes `max_chars` too. Every one of these is
opt-in: without them a read returns exactly what it returned before.

With no project named, a subject that has already spilled out of the window is **not** here:
name the project.

With sign-in on and no project named it shows the caller's own rows only. With `project`
named, anyone who may read that project gets every author's rows on it; `metadata.author` on
each row says who wrote it (since 2026-09-30). To read someone else's worklogs a
maintainer uses `GET /log/by?author=<email>`, which covers the window and every project's
log; see [sign-in-and-access.md](sign-in-and-access.md#whose-worklog-is-this).

### `GET /log/window`

What the window currently holds: the caps in force, which projects hold a slot, how
deep each is, and how recent. The window is silent by design — a spill leaves no trace
in the reply of `/vector/add` — so this route exists to make it verifiable rather than
merely trusted.

## Turning it off

`KH_HOTLOG=0` stops new writes entering the window **and drains what is still in it**
on the next log write, spilling every slot home. The flag therefore leaves the store in
exactly the shape it would have had if the window had never run.

Reads deliberately ignore the flag. Gating them on it was tried and caught in testing:
it hid every row still sitting in the window the moment the flag flipped.

## Counting rows correctly

`/vector/scroll` returns `matched` (rows matching the filter, independent of `limit`)
and `count` (rows in this page). Before 2026-08-29 `matched` was the fetched count and
could never exceed `limit`, which made a small read look complete.

**Page until `count < limit`.** Do not test `matched > limit`.

## Long rows and chunk vectors

The embedder reads 512 tokens (~2,000 characters) of a row. Since 2026-09-30 a longer row also gets
chunk vectors in `kh_chunk_<project>` (see `app/chunks.py`), so `/vector/query` finds what its tail
says and answers with the whole row. They are not rows: nothing on this page counts or moves them.
Rows stored earlier get theirs with `POST /vector/rechunk` (maintainers).
