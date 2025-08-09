#!/usr/bin/env node
/**
 * Ensure required Node dependencies are installed and run all migrations.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function needsInstall() {
  const modules = ['pg', 'dotenv'];
  return modules.some((m) => !fs.existsSync(path.join('node_modules', m)));
}

if (needsInstall()) {
  run('npm', ['install']);
}

run('npm', ['run', 'migrate']);
