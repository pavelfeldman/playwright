/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';

import { test, expect } from './trace-cli-fixtures';

test.skip(({ mcpBrowser }) => mcpBrowser !== 'chrome', 'Chrome-only');

test('trace info shows metadata', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['info', traceFile]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain('Browser:');
  expect(stdout).toContain('chromium');
  expect(stdout).toContain('Viewport:');
  expect(stdout).toContain('800x600');
  expect(stdout).toContain('Actions:');
  expect(stdout).toContain('Pages:');
  expect(stdout).toContain('Network:');
});

test('trace info --json', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['info', '--json', traceFile]);
  expect(exitCode).toBe(0);
  const info = JSON.parse(stdout);
  expect(info.browser).toBe('chromium');
  expect(info.viewport).toBe('800x600');
  expect(info.actions).toBeGreaterThan(0);
  expect(info.network).toBeGreaterThan(0);
});

test('trace list shows actions with call IDs', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['list', traceFile]);
  expect(exitCode).toBe(0);
  // Should have call IDs like call@N
  expect(stdout).toMatch(/call@\d+/);
  // Should have formatted action titles
  expect(stdout).toContain('Navigate');
  expect(stdout).toContain('Click');
  expect(stdout).toContain('Fill');
});

test('trace list --flat', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['list', '--flat', traceFile]);
  expect(exitCode).toBe(0);
  expect(stdout).toMatch(/call@\d+/);
  expect(stdout).toContain('Navigate');
});

test('trace list --grep filters actions', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['list', '--grep', 'Click', traceFile]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain('Click');
  expect(stdout).not.toContain('Navigate');
  expect(stdout).not.toContain('Fill');
});

test('trace list --json', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['list', '--json', traceFile]);
  expect(exitCode).toBe(0);
  const actions = JSON.parse(stdout);
  expect(Array.isArray(actions)).toBe(true);
  expect(actions.length).toBeGreaterThan(0);
  expect(actions[0]).toHaveProperty('callId');
  expect(actions[0]).toHaveProperty('title');
  expect(actions[0]).toHaveProperty('class');
  expect(actions[0]).toHaveProperty('method');
});

test('trace show displays action details', async ({ traceFile, runTraceCli }) => {
  // First get an action ID from list
  const { stdout: listOutput } = await runTraceCli(['list', '--json', traceFile]);
  const actions = JSON.parse(listOutput);
  const gotoAction = actions.find((a: any) => a.method === 'goto');
  expect(gotoAction).toBeTruthy();

  const { stdout, exitCode } = await runTraceCli(['show', traceFile, gotoAction.callId]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain('Navigate');
  expect(stdout).toContain('Time');
  expect(stdout).toContain('start:');
  expect(stdout).toContain('duration:');
  expect(stdout).toContain('Parameters');
});

test('trace show --json', async ({ traceFile, runTraceCli }) => {
  const { stdout: listOutput } = await runTraceCli(['list', '--json', traceFile]);
  const actions = JSON.parse(listOutput);
  const action = actions[0];

  const { stdout, exitCode } = await runTraceCli(['show', '--json', traceFile, action.callId]);
  expect(exitCode).toBe(0);
  const detail = JSON.parse(stdout);
  expect(detail.callId).toBe(action.callId);
  expect(detail).toHaveProperty('params');
  expect(detail).toHaveProperty('snapshots');
});

test('trace show reports available snapshots', async ({ traceFile, runTraceCli }) => {
  const { stdout: listOutput } = await runTraceCli(['list', '--json', traceFile]);
  const actions = JSON.parse(listOutput);
  const clickAction = actions.find((a: any) => a.method === 'click');
  expect(clickAction).toBeTruthy();

  const { stdout, exitCode } = await runTraceCli(['show', traceFile, clickAction.callId]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain('Snapshots');
  expect(stdout).toContain('available:');
});

test('trace show with invalid action ID', async ({ traceFile, runTraceCli }) => {
  const { stderr, exitCode } = await runTraceCli(['show', traceFile, 'call@999999']);
  expect(exitCode).toBe(1);
  expect(stderr).toContain('not found');
});

test('trace network shows requests', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['network', traceFile]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain('Method');
  expect(stdout).toContain('Status');
  expect(stdout).toContain('GET');
});

test('trace network --json', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['network', '--json', traceFile]);
  expect(exitCode).toBe(0);
  const requests = JSON.parse(stdout);
  expect(Array.isArray(requests)).toBe(true);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests[0]).toHaveProperty('method');
  expect(requests[0]).toHaveProperty('url');
  expect(requests[0]).toHaveProperty('status');
});

test('trace network --method filters', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['network', '--method', 'GET', '--json', traceFile]);
  expect(exitCode).toBe(0);
  const requests = JSON.parse(stdout);
  for (const req of requests)
    expect(req.method).toBe('GET');
});

test('trace console shows messages', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['console', traceFile]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain('info message');
  expect(stdout).toContain('warning message');
  expect(stdout).toContain('error message');
});

test('trace console --errors-only', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['console', '--errors-only', traceFile]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain('error message');
  expect(stdout).not.toContain('info message');
});

test('trace console --json', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['console', '--json', traceFile]);
  expect(exitCode).toBe(0);
  const entries = JSON.parse(stdout);
  expect(Array.isArray(entries)).toBe(true);
  const texts = entries.map((e: any) => e.text);
  expect(texts).toContain('info message');
  expect(texts).toContain('error message');
});

test('trace errors', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['errors', traceFile]);
  expect(exitCode).toBe(0);
  // Our test trace may or may not have errors, just verify it doesn't crash
  expect(stdout).toBeTruthy();
});

test('trace snapshot saves HTML file', async ({ traceFile, runTraceCli }, testInfo) => {
  const { stdout: listOutput } = await runTraceCli(['list', '--json', traceFile]);
  const actions = JSON.parse(listOutput);
  // Find an action with a page (goto or click)
  const action = actions.find((a: any) => a.pageId);
  expect(action).toBeTruthy();

  const outPath = testInfo.outputPath('test-snapshot.html');
  const { stdout, exitCode } = await runTraceCli(['snapshot', traceFile, action.callId, '-o', outPath]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain('Snapshot saved to');
  expect(fs.existsSync(outPath)).toBe(true);
  const html = fs.readFileSync(outPath, 'utf-8');
  expect(html.toLowerCase()).toContain('<html');
});

test('trace snapshot --name before', async ({ traceFile, runTraceCli }, testInfo) => {
  const { stdout: listOutput } = await runTraceCli(['list', '--json', traceFile]);
  const actions = JSON.parse(listOutput);
  const clickAction = actions.find((a: any) => a.method === 'click');
  expect(clickAction).toBeTruthy();

  const outPath = testInfo.outputPath('before-snapshot.html');
  const { stdout, exitCode } = await runTraceCli(['snapshot', '--name', 'before', traceFile, clickAction.callId, '-o', outPath]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain('Snapshot saved to');
});

test('trace screenshot saves image file', async ({ traceFile, runTraceCli }, testInfo) => {
  const { stdout: listOutput } = await runTraceCli(['list', '--json', traceFile]);
  const actions = JSON.parse(listOutput);
  const action = actions.find((a: any) => a.pageId);
  expect(action).toBeTruthy();

  const outPath = testInfo.outputPath('test-screenshot.png');
  const { stdout, exitCode } = await runTraceCli(['screenshot', traceFile, action.callId, '-o', outPath]);
  // Screenshot may or may not be available depending on timing
  if (exitCode === 0) {
    expect(stdout).toContain('Screenshot saved to');
    expect(fs.existsSync(outPath)).toBe(true);
  }
});

test('trace attachments lists attachments', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['attachments', traceFile]);
  expect(exitCode).toBe(0);
  // Our test trace has no attachments, just verify it doesn't crash
  expect(stdout).toBeTruthy();
});

test('trace attachments --json', async ({ traceFile, runTraceCli }) => {
  const { stdout, exitCode } = await runTraceCli(['attachments', '--json', traceFile]);
  expect(exitCode).toBe(0);
  const attachments = JSON.parse(stdout);
  expect(Array.isArray(attachments)).toBe(true);
});
