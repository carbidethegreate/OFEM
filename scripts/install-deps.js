#!/usr/bin/env node
/**
 * Install system dependencies using the platform package manager.
 * Supports Homebrew (macOS), apt (Linux), and Chocolatey (Windows).
 */
const { spawnSync } = require('child_process');
const os = process.platform;

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(result.status || 1);
  }
}

function exists(cmd) {
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

if (os === 'darwin') {
  if (!exists('brew')) {
    console.error('Homebrew not found. Install it from https://brew.sh');
    process.exit(1);
  }
  run('brew', ['update']);
  run('brew', ['install', 'node']);
  run('brew', ['install', '--cask', 'docker']);
} else if (os === 'linux') {
  if (exists('apt')) {
    run('sudo', ['apt', 'update']);
    run('sudo', ['apt', 'install', '-y', 'nodejs', 'npm', 'docker.io']);
  } else {
    console.error('apt not found. Install dependencies manually.');
  }
} else if (os === 'win32') {
  if (!exists('choco')) {
    console.error(
      'Chocolatey not found. Install it from https://chocolatey.org/install',
    );
    process.exit(1);
  }
  run('choco', ['install', '-y', 'nodejs', 'docker-desktop']);
} else {
  console.error(`Unsupported platform: ${os}`);
  process.exit(1);
}

// Install project npm dependencies
run('npm', ['install']);
