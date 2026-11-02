#!/usr/bin/env node
// SessionStart: give Claude a 5-line orientation (branch, active spec, dirty files).
// Anything printed to stdout is added to Claude's context.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { readInput, projectDir, git } from './lib.mjs';

const input = await readInput();
const root = projectDir(input);
const branch = git(['branch', '--show-current'], root) || '(no git)';
const dirty = (git(['status', '--porcelain'], root) || '').split('\n').filter(Boolean).length;

let activeSpec = null;
const specDir = path.join(root, '.claude', 'specs');
if (existsSync(specDir)) {
  for (const f of readdirSync(specDir)) {
    if (!f.endsWith('.md') || f.startsWith('_')) continue;
    const text = readFileSync(path.join(specDir, f), 'utf8');
    const m = text.match(/\*\*Branch:\*\*\s*`([^`]+)`/);
    if (m && m[1] === branch) activeSpec = f.replace(/\.md$/, '');
  }
}

const lines = [
  'LikeToOrder session context:',
  `- Branch: ${branch}${dirty ? ` (${dirty} uncommitted file${dirty > 1 ? 's' : ''})` : ' (clean)'}`,
  activeSpec
    ? `- Active spec: .claude/specs/${activeSpec}.md — load it with /start-feature ${activeSpec}`
    : branch === 'main'
      ? '- On main. Next: /feature-status, then /createspecs <n> <slug>.'
      : '- No spec matches this branch. Run /feature-status.',
  '- Follow CLAUDE.md. One feature per session.',
];
process.stdout.write(lines.join('\n') + '\n');
process.exit(0);
