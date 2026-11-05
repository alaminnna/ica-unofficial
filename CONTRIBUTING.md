# Contributing

1. Keep CommonJS (`require`), plain JavaScript, zero new runtime deps.
2. Port Instagram endpoints 1:1 from observed behavior — never invent.
3. Add/extend a test under `test/` for every behavior change; `npm test`
   must stay green without real credentials.
4. Never commit `cookies.json`, `bot.config.json`, `device/`, or any
   secrets. Test assets must stay synthetic (no real user data).
5. Run `npm pack --dry-run` before release PRs to check the file list.