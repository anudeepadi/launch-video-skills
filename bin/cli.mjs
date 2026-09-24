#!/usr/bin/env node
// launch-video-skills CLI: install the skill into coding agents, scaffold scenes, render.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(ROOT, 'skills/launch-video');
const HOME = homedir();

// Skill directories per agent. `home` is the dir whose presence means the agent is installed.
const AGENTS = {
  claude:   { home: '.claude',          user: '.claude/skills',          project: '.claude/skills' },
  codex:    { home: '.codex',           user: '.agents/skills',          project: '.agents/skills' },
  cursor:   { home: '.cursor',          user: '.cursor/skills',          project: '.cursor/skills' },
  gemini:   { home: '.gemini',          user: '.gemini/skills',          project: '.gemini/skills' },
  opencode: { home: '.config/opencode', user: '.config/opencode/skills', project: '.opencode/skills' },
};

const USAGE = `launch-video-skills

  npx launch-video-skills install [--agents claude,codex,...|all] [--project]
      Copy the launch-video skill into each agent's skills folder.
      Default: every agent found in your home dir (${Object.keys(AGENTS).join(', ')}).
      --project installs into the current repo instead of your home dir.
  npx launch-video-skills setup
      Download headless Chromium and the Python voice packages (one time).
  npx launch-video-skills new <name>
      Scaffold ./launch-videos/scenes/<name>/index.html with the kit next to it.
  npx launch-video-skills render <scene.html> [--sheet 1 | --stills t1,t2 | --out file.mp4 ...]
      Render a scene. Output goes to ./out/.`;

const die = (msg) => { console.error(`error: ${msg}`); process.exit(1); };
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };

function pickAgents() {
  const raw = opt('agents');
  if (!raw) {
    const found = Object.keys(AGENTS).filter((a) => existsSync(join(HOME, AGENTS[a].home)));
    if (!found.length) die(`no supported agent found in ${HOME}. Pass --agents ${Object.keys(AGENTS).join(',')}`);
    return found;
  }
  const names = raw === 'all' ? Object.keys(AGENTS) : raw.split(',').map((s) => s.trim());
  const bad = names.filter((n) => !AGENTS[n]);
  if (bad.length) die(`unknown agent(s): ${bad.join(', ')}. Supported: ${Object.keys(AGENTS).join(', ')}`);
  return names;
}

function install() {
  const project = argv.includes('--project');
  const base = project ? process.cwd() : HOME;
  const done = new Set();
  for (const agent of pickAgents()) {
    const dest = join(base, project ? AGENTS[agent].project : AGENTS[agent].user, 'launch-video');
    if (!done.has(dest)) {
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(SKILL, dest, { recursive: true, force: true });
      done.add(dest);
    }
    console.log(`${agent.padEnd(9)}-> ${dest}`);
  }
  console.log('\nNext: npx launch-video-skills setup   (once per machine)');
}

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error) die(`${cmd} not found (${r.error.code})`);
  return r.status === 0;
}

function setup() {
  const ffmpeg = spawnSync('ffmpeg', ['-version']);
  if (ffmpeg.error) console.warn('warning: ffmpeg not on PATH. Install it (brew install ffmpeg / apt install ffmpeg).');
  const pwCli = join(dirname(createRequire(import.meta.url).resolve('playwright/package.json')), 'cli.js');
  const okChrome = process.env.LVK_CHROME ? true : run(process.execPath, [pwCli, 'install', 'chromium']);
  const okPy = run(process.env.PYTHON || 'python3', ['-m', 'pip', 'install', '-r', join(ROOT, 'requirements.txt')]);
  if (!okChrome) console.warn('Chromium install failed. Point LVK_CHROME at any local chrome-headless-shell instead.');
  if (!okPy) console.warn('pip install failed. Voice needs it; --no-voice renders still work.');
  if (!(okChrome && okPy)) process.exit(1);
}

function scaffold() {
  const name = argv[1];
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) die('usage: new <name>  (lowercase letters, digits, dashes)');
  const base = resolve('launch-videos');
  const dest = join(base, 'scenes', name);
  if (existsSync(dest)) die(`${dest} already exists`);
  cpSync(join(ROOT, 'kit'), join(base, 'kit'), { recursive: true, force: true });
  mkdirSync(join(dest, 'assets'), { recursive: true });
  writeFileSync(join(dest, 'index.html'), readFileSync(join(ROOT, 'scenes/_template/index.html')));
  console.log(`${join(dest, 'index.html')}\nPreview: npx launch-video-skills render ${join('launch-videos/scenes', name, 'index.html')} --sheet 1`);
}

function render() {
  const r = spawnSync(process.execPath, [join(ROOT, 'render.mjs'), ...argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const commands = { install, setup, new: scaffold, render };
const cmd = commands[argv[0]];
if (!cmd) { console.log(USAGE); process.exit(argv[0] && !['-h', '--help', 'help'].includes(argv[0]) ? 1 : 0); }
cmd();
