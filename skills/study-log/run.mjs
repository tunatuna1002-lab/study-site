// Entry point for the skill. Node resolves the main module's real path, so this works
// through the ~/.claude/skills/study-log symlink (macOS) or junction (Windows).
const { runCli } = await import(new URL('../../scripts/study-log.mjs', import.meta.url));
await runCli();
