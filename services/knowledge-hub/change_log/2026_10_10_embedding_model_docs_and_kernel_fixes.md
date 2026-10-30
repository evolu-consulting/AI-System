# 2026-10-10 - API docs name the real embedding model; kernel and Stop hook fixes (F1, F2)

| Release | What changed | Where it runs |
|---|---|---|
| server (docs only) | OpenAPI text of `/vector/add`, `/vector/query`, `/graph/direct-add` and their schemas names bge-small-en-v1.5 (English-only) instead of paraphrase-multilingual-MiniLM-L12-v2. | KH server; no behaviour change |
| hook rows (live data) | Kernel rule (4) and action 'suggest a tool' build the personal project id from kh_me only; Stop hook's forced turn writes one short line in the person's language. | KH hooks/policy store; no deploy needed |

## What was wrong

- Docs: the model was switched to bge-small-en-v1.5 (`app/config.py`), but the OpenAPI descriptions still
  promised the multilingual model and "Vietnamese is first-class". Measured: English 'how do I install the
  auto login tool' scored 0.79 on the install guide, the Vietnamese wording 0.63.
- F1: in the kernel regression test, child sessions built `personal-rowan-hoang-laidon-com` from the Claude
  account e-mail in their system context, while the KH identity (kh_me) was `vndiary@gmail.com`. 'suggest a
  tool' would read and write tool decisions in the wrong personal project.
- F2: the extra turn forced by the Stop hook was sometimes answered in English.

## What changed

- `main.py`, `app/schemas.py`: descriptions only.
- Kernel (SessionStart 'kernel', id 2), rule (4): personal id = 'personal-' + the kh_me e-mail, slugged;
  never from any other e-mail. 5326 -> 5493 chars.
- 'suggest a tool' rules 'asked before' and 'record': `<kh_me e-mail>` / `personal-<kh_me e-mail slug>`.
- Stop 'store-log' (id 6): any text the forced turn writes is one short line in the language of the
  person's last message. A first wording ('end with no text') was dropped: Claude Code demands a visible
  reply after a blocking Stop hook, so it could not be obeyed.

## Deploy

Server docs change not deployed to BTP yet: docs-only, so it waits for the next behavioural change
instead of restarting prod on its own.
