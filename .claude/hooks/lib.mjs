// Shared helpers for LikeToOrder Claude Code hooks.
// Hooks receive a JSON payload on stdin. Exit code 2 = block the tool call
// and send stderr back to Claude as the reason.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

export function block(reason) {
  process.stderr.write(`BLOCKED by LikeToOrder hook: ${reason}\n`);
  process.exit(2);
}

export function projectDir(input) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

export function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export function relPath(filePath, root) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  return path.relative(root, abs).split(path.sep).join('/');
}
