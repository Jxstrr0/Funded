// Smoke test: the config loads, and the suite leaves a stamp of its last run
// (tools read it to show "tests last run" in their output).
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VERSION } from '../js/config.js';

test('version is four numbers', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+\.\d+$/);
  try { writeFileSync(join(tmpdir(), 'funded-tests-last-run.txt'), new Date().toISOString()); } catch {}
});
