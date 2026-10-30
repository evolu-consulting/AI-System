# Todo CLI

A tiny command line todo list for one person. It is a Python 3.10 package named `todo`
that uses the standard library only.

## Interface

The program is run as `python -m todo --file PATH COMMAND [ARGS]` from the repository root.
PATH is the JSON file that holds the tasks; a missing file is an error: every command prints `error: no file` and exits with code 2.
Normal output goes to standard output; error messages go to standard error.

## Storage

The file holds one JSON object: `{"tasks": [...]}`. Each task is an object with the keys
`id` (integer), `text` (string), `done` (boolean) and `priority` (integer).
Ids start at 1 and are never reused: a new task gets the highest id ever stored plus one.

## F1 Add and list tasks

- `add TEXT` stores a new open task and prints `added ID`, for example `added 1` for the first task.
- `list` prints one line per task in id order: `ID [ ] TEXT` for an open task and `ID [x] TEXT` for a done task.
- `list` on an empty file prints nothing and exits with code 0.

## F2 Complete and remove tasks

- `done ID` marks the task as done in the file and prints `done ID`.
- `remove ID` deletes the task from the file and prints `removed ID`.
- For an unknown ID, `done` and `remove` print `error: no task ID` to standard error and exit with code 1.

## F3 Priority

- `add TEXT --priority N` stores the task with priority N, where N is 1, 2 or 3 (1 is the most urgent).
- A task added without `--priority` gets priority 2.
- `list --priority` prints the tasks sorted by priority, most urgent first; tasks with the same priority stay in id order.
