# DLC processes in a local Dify (test kit)

Test of line.difyproc (LINE_PROCESS_SOURCE=dify) against a local Dify 1.14.2, run 2026-10-19.

1. Dify: `git clone --depth 1 --branch 1.14.2 https://github.com/langgenius/dify`, in `docker/`: copy `.env.example`
   to `.env`, set `EXPOSE_NGINX_PORT=4203`, `EXPOSE_NGINX_SSL_PORT=4443` and a new `SECRET_KEY`, `docker compose up -d`.
   The first start often fails while Postgres initialises (db unhealthy, plugin_daemon restarting): run `up -d` again.
2. `python gen_flows.py flows` (the four process apps as DSL 0.6.0), then `python bootstrap.py` (admin account with a
   generated password in admin-login.txt, imports + publishes the apps, API keys in flows.json). Both files hold
   secrets and stay out of git.
3. `./start-engine.sh fake|cli` runs the engine from this source on 127.0.0.1:8797 with its own data; edit the paths
   at the top for another machine. Then `python drive.py --sdlc <Slaves/SDLC> --work <dir> --pack packs`.

Results of the first run: real model, bug-fix / enhancement / new-system green; issues are in the ai-sdlc work log
(topic "dify local setup and dlc process test").
