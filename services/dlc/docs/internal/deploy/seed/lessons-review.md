# Lesson seed for a customer KH - review (INTERNAL)

**Summary for Rowan.**
- KH prod `lesson-learned` export: 377 rows (369 lessons, 8 guides) on 2026-10-11T17:11:52Z; customer file keeps 367 lessons.
- 10 dropped: all 8 internal guides (own tools, work logging, internal endpoints) plus 2 lessons (App Session Manager tool, internal estimation standard). 1 changed: internal names and machine paths neutralised.
- Leftover check `check_lessons.py lessons-customer.json`: CLEAN (0 hits). Review the dropped list below; restore a row only after editing it by hand.

## Files

| File | Use |
|---|---|
| `lessons-raw.json` | INTERNAL raw export, never ship |
| `lessons-customer.json` | seed for the customer KH (`rows[]`: `id` seed_..., `text`, `metadata` {kind, topic, category, title, source}) |
| `check_lessons.py` | leftover scanner; exit 1 on any internal identifier |
| `lessons-review.md` | this list |

## Dropped (10)

| Source id | Title | Reason |
|---|---|---|
| `vec_53efbc1a9b3c` | KNOWLEDGE HUB - PEOPLE, ROLES AND ACCESS (read live, never from memory). The access model changes; always read | internal process/tool guide (owner's own tools, endpoints or work-logging process); not applicable to a customer agent-only KH |
| `vec_51e10889bc87` | WORKBEATS - THE WB HELPER TO PASTE INTO THE LOGGED-IN TAB (for the log-work process, see topic workbeats-log-w | internal process/tool guide (owner's own tools, endpoints or work-logging process); not applicable to a customer agent-only KH |
| `vec_4aa82880e8c8` | WORKBEATS - HOW TO LOG WORK (the process). Seeded 2026-09-28 from the Workbeats handoff; hours are logged as a | internal process/tool guide (owner's own tools, endpoints or work-logging process); not applicable to a customer agent-only KH |
| `vec_cff8a1caca66` | WORKBEATS - THE API (for the log-work process, see topic workbeats-log-work). Seeded 2026-09-28. | internal process/tool guide (owner's own tools, endpoints or work-logging process); not applicable to a customer agent-only KH |
| `vec_bee695e04e5f` | LOCAL KH ON 127.0.0.1:9000 - HOW TO READ IT FROM A SESSION WIRED TO KH BTP (no hook change needed). Written 20 | internal process/tool guide (owner's own tools, endpoints or work-logging process); not applicable to a customer agent-only KH |
| `vec_11d6258a693f` | Open MS Teams on the web, not the desktop app | internal process/tool guide (owner's own tools, endpoints or work-logging process); not applicable to a customer agent-only KH |
| `vec_97d9b4bc1708` | Reference the 'designer' project for UI style. When you need to design a user interface (screens, pages, artif | internal process/tool guide (owner's own tools, endpoints or work-logging process); not applicable to a customer agent-only KH |
| `vec_0459101b184c` | INSTALL POINTER: install, set up, download, update, move or uninstall the App Session Manager (AutoLogin) desk | internal process/tool guide (owner's own tools, endpoints or work-logging process); not applicable to a customer agent-only KH |
| `vec_efe15b9a9fae` | Use the local App Session Manager (AutoLogin) before asking the user to sign in. | internal tool (App Session Manager / AutoLogin on the owner's desktop); not applicable to a customer KH |
| `vec_7e862c92df8a` | ESTIMATION STANDARD [planning / Claude Code build speed] (Rowan, first 2026-10-03, revised 2026-10-11 after me | internal commercial estimation standard (build-speed ratios used for quotes); commercially sensitive |

## Changed (1)

| Source id | New id | Replacements |
|---|---|---|
| `vec_02451c557ed1` | `seed_6972f9a8e5500088` | win-path x3 (C:/RWTemp, E:/Workspaces, E:/Workspaces/EvoBuzz/game-center); internal-project x1 (EvoBuzz) |

## Counts

- exported: 377
- in customer file: 367
- changed: 1
- dropped: 10
- unchanged and kept: 366

Sanitizer rules applied to every kept row: internal URLs -> [internal-url], e-mails -> [email], person names -> [person], customer/company names -> [customer], internal project names -> [internal project], machine paths -> [path], KH row ids -> [ref], repo/org names -> [repo], secret-looking strings -> [secret]. Seed ids are `seed_` + sha256(text)[:16].
