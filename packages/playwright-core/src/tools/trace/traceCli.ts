/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable no-console */

import fs from 'fs';
import path from 'path';

import { TraceModel, buildActionTree, eventsForAction } from '../../utils/isomorphic/trace/traceModel';
import { TraceLoader } from '../../utils/isomorphic/trace/traceLoader';
import { renderTitleForCall } from '../../utils/isomorphic/protocolFormatter';
import { asLocatorDescription } from '../../utils/isomorphic/locatorGenerators';
import { ZipTraceLoaderBackend } from './traceParser';

import type { ActionTraceEventInContext } from '@isomorphic/trace/traceModel';
import type { Language } from '@isomorphic/locatorGenerators';
import type { Command } from '../../utilsBundle';

export function addTraceCommands(program: Command, logErrorAndExit: (e: Error) => void) {
  const traceCommand = program
      .command('trace')
      .description('inspect trace files from the command line');

  traceCommand
      .command('info <trace>')
      .description('show trace metadata')
      .option('--json', 'output as JSON')
      .action(function(trace: string, options: { json?: boolean }) {
        traceInfo(trace, options).catch(logErrorAndExit);
      });

  traceCommand
      .command('list <trace>')
      .description('list actions in the trace')
      .option('--flat', 'flat list instead of tree')
      .option('--grep <pattern>', 'filter actions by title pattern')
      .option('--errors-only', 'only show failed actions')
      .option('--json', 'output as JSON')
      .action(function(trace: string, options: { flat?: boolean, grep?: string, errorsOnly?: boolean, json?: boolean }) {
        traceList(trace, options).catch(logErrorAndExit);
      });

  traceCommand
      .command('show <trace> <action-id>')
      .description('show details of a specific action')
      .option('--json', 'output as JSON')
      .action(function(trace: string, actionId: string, options: { json?: boolean }) {
        traceShow(trace, actionId, options).catch(logErrorAndExit);
      });

  traceCommand
      .command('network <trace>')
      .description('show network requests')
      .option('--grep <pattern>', 'filter by URL pattern')
      .option('--method <method>', 'filter by HTTP method')
      .option('--status <code>', 'filter by status code')
      .option('--failed', 'only show failed requests (status >= 400)')
      .option('--json', 'output as JSON')
      .action(function(trace: string, options: { grep?: string, method?: string, status?: string, failed?: boolean, json?: boolean }) {
        traceNetwork(trace, options).catch(logErrorAndExit);
      });

  traceCommand
      .command('console <trace>')
      .description('show console messages')
      .option('--errors-only', 'only show errors')
      .option('--warnings', 'show errors and warnings')
      .option('--browser', 'only browser console messages')
      .option('--stdio', 'only stdout/stderr')
      .option('--json', 'output as JSON')
      .action(function(trace: string, options: { errorsOnly?: boolean, warnings?: boolean, browser?: boolean, stdio?: boolean, json?: boolean }) {
        traceConsole(trace, options).catch(logErrorAndExit);
      });

  traceCommand
      .command('errors <trace>')
      .description('show errors with stack traces')
      .option('--json', 'output as JSON')
      .action(function(trace: string, options: { json?: boolean }) {
        traceErrors(trace, options).catch(logErrorAndExit);
      });

  traceCommand
      .command('snapshot <trace> <action-id>')
      .description('save or serve DOM snapshot for an action')
      .option('--name <name>', 'snapshot phase: before, input, or after', 'before')
      .option('-o, --output <path>', 'output file path')
      .option('--serve', 'serve snapshot on local HTTP server')
      .option('--port <port>', 'port for serve mode')
      .action(function(trace: string, actionId: string, options: { name?: string, output?: string, serve?: boolean, port?: number }) {
        traceSnapshot(trace, actionId, options).catch(logErrorAndExit);
      });

  traceCommand
      .command('screenshot <trace> <action-id>')
      .description('save screencast screenshot for an action')
      .option('-o, --output <path>', 'output file path')
      .action(function(trace: string, actionId: string, options: { output?: string }) {
        traceScreenshot(trace, actionId, options).catch(logErrorAndExit);
      });

  traceCommand
      .command('attachments <trace>')
      .description('list or extract trace attachments')
      .option('--save <name>', 'extract attachment by name')
      .option('-o, --output <path>', 'output file/directory path')
      .option('--json', 'output as JSON')
      .action(function(trace: string, options: { save?: string, output?: string, json?: boolean }) {
        traceAttachments(trace, options).catch(logErrorAndExit);
      });

  traceCommand
      .command('install-skill')
      .description('install SKILL.md for LLM integration')
      .action(function() {
        installSkill().catch(logErrorAndExit);
      });
}

export async function loadTrace(traceFile: string): Promise<{ model: TraceModel, loader: TraceLoader }> {
  const filePath = path.resolve(traceFile);
  if (!fs.existsSync(filePath))
    throw new Error(`Trace file not found: ${filePath}`);
  const backend = new ZipTraceLoaderBackend(filePath);
  const loader = new TraceLoader();
  await loader.load(backend, () => undefined);
  return { model: new TraceModel(filePath, loader.contextEntries), loader };
}

export async function loadTraceModel(traceFile: string): Promise<TraceModel> {
  return (await loadTrace(traceFile)).model;
}

function msToString(ms: number): string {
  if (ms < 0 || !isFinite(ms))
    return '-';
  if (ms === 0)
    return '0';
  if (ms < 1000)
    return ms.toFixed(0) + 'ms';
  const seconds = ms / 1000;
  if (seconds < 60)
    return seconds.toFixed(1) + 's';
  const minutes = seconds / 60;
  if (minutes < 60)
    return minutes.toFixed(1) + 'm';
  const hours = minutes / 60;
  if (hours < 24)
    return hours.toFixed(1) + 'h';
  const days = hours / 24;
  return days.toFixed(1) + 'd';
}

function bytesToString(bytes: number): string {
  if (bytes < 0 || !isFinite(bytes))
    return '-';
  if (bytes === 0)
    return '0';
  if (bytes < 1000)
    return bytes.toFixed(0);
  const kb = bytes / 1024;
  if (kb < 1000)
    return kb.toFixed(1) + 'K';
  const mb = kb / 1024;
  if (mb < 1000)
    return mb.toFixed(1) + 'M';
  const gb = mb / 1024;
  return gb.toFixed(1) + 'G';
}

function formatTimestamp(ms: number, base: number): string {
  const relative = ms - base;
  if (relative < 0)
    return '0:00.000';
  const totalMs = Math.floor(relative);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

function actionTitle(action: ActionTraceEventInContext, sdkLanguage?: Language): string {
  const title = renderTitleForCall({ ...action, type: action.class }) || `${action.class}.${action.method}`;
  const locator = action.params.selector ? asLocatorDescription(sdkLanguage || 'javascript', action.params.selector) : undefined;
  if (locator)
    return `${title} ${locator}`;
  return title;
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function padStart(str: string, len: number): string {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

// ---- trace list ----

export async function traceList(traceFile: string, options: { flat?: boolean, grep?: string, errorsOnly?: boolean, json?: boolean }) {
  const model = await loadTraceModel(traceFile);
  const lang = model.sdkLanguage;

  if (options.json) {
    const actions = filterActions(model.actions, options, lang);
    const result = actions.map(a => ({
      callId: a.callId,
      title: actionTitle(a, lang),
      class: a.class,
      method: a.method,
      params: a.params,
      startTime: a.startTime,
      endTime: a.endTime,
      duration: a.endTime ? a.endTime - a.startTime : undefined,
      error: a.error?.message,
      parentId: a.parentId,
      pageId: a.pageId,
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const actions = filterActions(model.actions, options, lang);

  if (options.flat) {
    for (const action of actions) {
      const ts = formatTimestamp(action.startTime, model.startTime);
      const duration = action.endTime ? msToString(action.endTime - action.startTime) : 'running';
      const title = actionTitle(action, lang);
      const error = action.error ? '  ✗' : '';
      console.log(`  ${padEnd(action.callId, 12)} ${ts}  ${padEnd(title, 55)} ${padStart(duration, 8)}${error}`);
    }
    return;
  }

  // Tree view
  const { rootItem } = buildActionTree(actions);
  const visit = (item: ReturnType<typeof buildActionTree>['rootItem'], indent: string) => {
    const action = item.action;
    const ts = formatTimestamp(action.startTime, model.startTime);
    const duration = action.endTime ? msToString(action.endTime - action.startTime) : 'running';
    const title = actionTitle(action as ActionTraceEventInContext, lang);
    const error = action.error ? '  ✗' : '';
    console.log(`  ${padEnd(action.callId, 12)} ${ts}  ${indent}${padEnd(title, Math.max(1, 55 - indent.length))} ${padStart(duration, 8)}${error}`);
    for (const child of item.children)
      visit(child, indent + '  ');
  };
  for (const child of rootItem.children)
    visit(child, '');
}

function filterActions(actions: ActionTraceEventInContext[], options: { grep?: string, errorsOnly?: boolean }, lang?: Language): ActionTraceEventInContext[] {
  let result = actions;
  if (options.grep) {
    const pattern = new RegExp(options.grep, 'i');
    result = result.filter(a => pattern.test(actionTitle(a, lang)));
  }
  if (options.errorsOnly)
    result = result.filter(a => !!a.error);
  return result;
}

// ---- trace show ----

export async function traceShow(traceFile: string, actionId: string, options: { json?: boolean }) {
  const model = await loadTraceModel(traceFile);
  const lang = model.sdkLanguage;
  const action = model.actions.find(a => a.callId === actionId);
  if (!action) {
    console.error(`Action '${actionId}' not found. Use 'trace list --json' to see available action IDs.`);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    const events = eventsForAction(action);
    const snapshots = [
      ...(action.beforeSnapshot ? ['before'] : []),
      ...(action.inputSnapshot ? ['input'] : []),
      ...(action.afterSnapshot ? ['after'] : []),
    ];
    console.log(JSON.stringify({
      callId: action.callId,
      title: actionTitle(action, lang),
      class: action.class,
      method: action.method,
      params: action.params,
      result: action.result,
      startTime: action.startTime,
      endTime: action.endTime,
      duration: action.endTime ? action.endTime - action.startTime : undefined,
      error: action.error,
      log: action.log,
      stack: action.stack,
      pageId: action.pageId,
      parentId: action.parentId,
      snapshots,
      point: action.point,
      events: events.map(e => ({ type: e.type, time: e.time, ...('method' in e ? { method: e.method } : {}), ...('text' in e ? { text: e.text } : {}) })),
    }, null, 2));
    return;
  }

  const title = actionTitle(action, lang);
  console.log(`\n  ${title}\n`);

  // Time
  console.log('  Time');
  console.log(`    start:     ${formatTimestamp(action.startTime, model.startTime)}`);
  const duration = action.endTime ? msToString(action.endTime - action.startTime) : (action.error ? 'Timed Out' : 'Running');
  console.log(`    duration:  ${duration}`);

  // Parameters
  const paramKeys = Object.keys(action.params).filter(name => name !== 'info');
  if (paramKeys.length) {
    console.log('\n  Parameters');
    for (const key of paramKeys) {
      const value = formatParamValue(action.params[key]);
      console.log(`    ${key}: ${value}`);
    }
  }

  // Return value
  if (action.result) {
    console.log('\n  Return value');
    for (const [key, value] of Object.entries(action.result))
      console.log(`    ${key}: ${formatParamValue(value)}`);

  }

  // Error
  if (action.error) {
    console.log('\n  Error');
    console.log(`    ${action.error.message}`);
  }

  // Logs
  if (action.log.length) {
    console.log('\n  Log');
    for (const entry of action.log) {
      const time = entry.time !== -1 ? formatTimestamp(entry.time, model.startTime) : '';
      console.log(`    ${padEnd(time, 12)} ${entry.message}`);
    }
  }

  // Source
  if (action.stack?.length) {
    console.log('\n  Source');
    for (const frame of action.stack.slice(0, 5)) {
      const file = frame.file.replace(/.*[/\\](.*)/, '$1');
      console.log(`    ${file}:${frame.line}:${frame.column}`);
    }
  }

  // Snapshots
  const snapshots: string[] = [];
  if (action.beforeSnapshot)
    snapshots.push('before');
  if (action.inputSnapshot)
    snapshots.push('input');
  if (action.afterSnapshot)
    snapshots.push('after');
  if (snapshots.length) {
    console.log('\n  Snapshots');
    console.log(`    available: ${snapshots.join(', ')}`);
    console.log(`    usage:     npx playwright trace snapshot <trace> ${actionId} --name <${snapshots.join('|')}>`);
  }
  console.log('');
}

function formatParamValue(value: any): string {
  if (value === undefined || value === null)
    return String(value);
  if (typeof value === 'string')
    return `"${value}"`;
  if (typeof value !== 'object')
    return String(value);
  if (value.guid)
    return '<handle>';
  return JSON.stringify(value).slice(0, 1000);
}

// ---- trace network ----

export async function traceNetwork(traceFile: string, options: { grep?: string, method?: string, status?: string, failed?: boolean, json?: boolean }) {
  const model = await loadTraceModel(traceFile);
  let resources = model.resources;

  if (options.grep) {
    const pattern = new RegExp(options.grep, 'i');
    resources = resources.filter(r => pattern.test(r.request.url));
  }
  if (options.method)
    resources = resources.filter(r => r.request.method.toLowerCase() === options.method!.toLowerCase());
  if (options.status) {
    const code = parseInt(options.status, 10);
    resources = resources.filter(r => r.response.status === code);
  }
  if (options.failed)
    resources = resources.filter(r => r.response.status >= 400 || r.response.status === -1);

  if (options.json) {
    const result = resources.map(r => ({
      method: r.request.method,
      url: r.request.url,
      status: r.response.status,
      statusText: r.response.statusText,
      contentType: r.response.content.mimeType,
      duration: r.time,
      size: r.response._transferSize! > 0 ? r.response._transferSize! : r.response.bodySize,
      route: formatRouteStatus(r),
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!resources.length) {
    console.log('  No network requests');
    return;
  }
  console.log(`  ${padEnd('Method', 8)} ${padEnd('Status', 8)} ${padEnd('Name', 45)} ${padStart('Duration', 10)} ${padStart('Size', 8)} ${padEnd('Route', 10)}`);
  console.log(`  ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(45)} ${'─'.repeat(10)} ${'─'.repeat(8)} ${'─'.repeat(10)}`);

  for (const r of resources) {
    let name: string;
    try {
      const url = new URL(r.request.url);
      name = url.pathname.substring(url.pathname.lastIndexOf('/') + 1);
      if (!name)
        name = url.host;
      if (url.search)
        name += url.search;
    } catch {
      name = r.request.url;
    }
    if (name.length > 45)
      name = name.substring(0, 42) + '...';

    const status = r.response.status > 0 ? String(r.response.status) : 'ERR';
    const size = r.response._transferSize! > 0 ? r.response._transferSize! : r.response.bodySize;
    const route = formatRouteStatus(r);
    console.log(`  ${padEnd(r.request.method, 8)} ${padEnd(status, 8)} ${padEnd(name, 45)} ${padStart(msToString(r.time), 10)} ${padStart(bytesToString(size), 8)} ${padEnd(route, 10)}`);
  }
}

function formatRouteStatus(r: { _wasAborted?: boolean, _wasContinued?: boolean, _wasFulfilled?: boolean, _apiRequest?: boolean }): string {
  if (r._wasAborted)
    return 'aborted';
  if (r._wasContinued)
    return 'continued';
  if (r._wasFulfilled)
    return 'fulfilled';
  if (r._apiRequest)
    return 'api';
  return '';
}

// ---- trace console ----

export async function traceConsole(traceFile: string, options: { errorsOnly?: boolean, warnings?: boolean, browser?: boolean, stdio?: boolean, json?: boolean }) {
  const model = await loadTraceModel(traceFile);

  type ConsoleItem = {
    type: 'browser' | 'stdout' | 'stderr';
    level: string;
    text: string;
    location?: string;
    timestamp: number;
  };

  const items: ConsoleItem[] = [];

  for (const event of model.events) {
    if (event.type === 'console') {
      if (options.stdio)
        continue;
      const level = event.messageType;
      if (options.errorsOnly && level !== 'error')
        continue;
      if (options.warnings && level !== 'error' && level !== 'warning')
        continue;
      const url = event.location.url;
      const filename = url ? url.substring(url.lastIndexOf('/') + 1) : '<anonymous>';
      items.push({
        type: 'browser',
        level,
        text: event.text,
        location: `${filename}:${event.location.lineNumber}`,
        timestamp: event.time,
      });
    }
    if (event.type === 'event' && event.method === 'pageError') {
      if (options.stdio)
        continue;
      const error = event.params.error;
      items.push({
        type: 'browser',
        level: 'error',
        text: error?.error?.message || String(error?.value || ''),
        timestamp: event.time,
      });
    }
  }

  for (const event of model.stdio) {
    if (options.browser)
      continue;
    if (options.errorsOnly && event.type !== 'stderr')
      continue;
    if (options.warnings && event.type !== 'stderr')
      continue;
    let text = '';
    if (event.text)
      text = event.text.trim();
    if (event.base64)
      text = Buffer.from(event.base64, 'base64').toString('utf-8').trim();
    if (!text)
      continue;
    items.push({
      type: event.type as 'stdout' | 'stderr',
      level: event.type === 'stderr' ? 'error' : 'info',
      text,
      timestamp: event.timestamp,
    });
  }

  items.sort((a, b) => a.timestamp - b.timestamp);

  if (options.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (!items.length) {
    console.log('  No console entries');
    return;
  }

  for (const item of items) {
    const ts = formatTimestamp(item.timestamp, model.startTime);
    const source = item.type === 'browser' ? '[browser]' : `[${item.type}]`;
    const level = padEnd(item.level, 8);
    const location = item.location ? `  ${item.location}` : '';
    console.log(`  ${ts}  ${padEnd(source, 10)} ${level} ${item.text}${location}`);
  }
}

// ---- trace errors ----

export async function traceErrors(traceFile: string, options: { json?: boolean }) {
  const model = await loadTraceModel(traceFile);
  const lang = model.sdkLanguage;

  if (options.json) {
    const result = model.errorDescriptors.map(e => ({
      message: e.message,
      action: e.action ? { callId: e.action.callId, title: actionTitle(e.action, lang) } : undefined,
      stack: e.stack,
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!model.errorDescriptors.length) {
    console.log('  No errors');
    return;
  }

  for (const error of model.errorDescriptors) {
    if (error.action) {
      const title = actionTitle(error.action, lang);
      console.log(`\n  ✗ ${title}`);
    } else {
      console.log(`\n  ✗ Error`);
    }

    if (error.stack?.length) {
      const frame = error.stack[0];
      const file = frame.file.replace(/.*[/\\](.*)/, '$1');
      console.log(`    at ${file}:${frame.line}:${frame.column}`);
    }
    console.log('');
    const indented = error.message.split('\n').map(l => `    ${l}`).join('\n');
    console.log(indented);
  }
  console.log('');
}

// ---- trace snapshot ----

export async function traceSnapshot(traceFile: string, actionId: string, options: { name?: string, output?: string, serve?: boolean, port?: number }) {
  const { model, loader } = await loadTrace(traceFile);

  const action = model.actions.find(a => a.callId === actionId);
  if (!action) {
    console.error(`Action '${actionId}' not found.`);
    process.exitCode = 1;
    return;
  }

  const pageId = action.pageId;
  if (!pageId) {
    console.error(`Action '${actionId}' has no associated page.`);
    process.exitCode = 1;
    return;
  }

  const storage = loader.storage();

  let snapshotName: string | undefined;
  let renderer;
  if (options.name) {
    snapshotName = options.name;
    renderer = storage.snapshotByName(pageId, `${snapshotName}@${actionId}`);
  } else {
    for (const candidate of ['input', 'before', 'after']) {
      renderer = storage.snapshotByName(pageId, `${candidate}@${actionId}`);
      if (renderer) {
        snapshotName = candidate;
        break;
      }
    }
  }

  if (!renderer || !snapshotName) {
    console.error(`No snapshot found for action '${actionId}'.`);
    process.exitCode = 1;
    return;
  }

  const snapshotKey = `${snapshotName}@${actionId}`;

  const rendered = renderer.render();
  const outFile = options.output || `snapshot-${actionId.replace(/[^a-zA-Z0-9@]/g, '_')}-${snapshotName}.html`;

  if (options.serve) {
    const { SnapshotServer } = require('../../utils/isomorphic/trace/snapshotServer') as typeof import('../../utils/isomorphic/trace/snapshotServer');
    const { HttpServer } = require('../../server/utils/httpServer') as typeof import('../../server/utils/httpServer');

    const snapshotServer = new SnapshotServer(storage, sha1 => loader.resourceForSha1(sha1));
    const httpServer = new HttpServer();

    httpServer.routePrefix('/snapshot', (request, response) => {
      const url = new URL('http://localhost' + request.url!);
      const searchParams = url.searchParams;
      searchParams.set('name', snapshotKey);
      const snapshotResponse = snapshotServer.serveSnapshot(pageId, searchParams, '/snapshot');
      response.statusCode = snapshotResponse.status;
      snapshotResponse.headers.forEach((value, key) => response.setHeader(key, value));
      snapshotResponse.text().then(text => response.end(text));
      return true;
    });

    httpServer.routePrefix('/', (request, response) => {
      response.statusCode = 302;
      response.setHeader('Location', '/snapshot');
      response.end();
      return true;
    });

    await httpServer.start({ preferredPort: options.port || 0 });
    console.log(`Snapshot served at ${httpServer.urlPrefix('human-readable')}`);
    return;
  }

  fs.writeFileSync(outFile, rendered.html, 'utf-8');
  console.log(`  Snapshot saved to ${outFile}`);
}

// ---- trace screenshot ----

export async function traceScreenshot(traceFile: string, actionId: string, options: { output?: string }) {
  const { model, loader } = await loadTrace(traceFile);

  const action = model.actions.find(a => a.callId === actionId);
  if (!action) {
    console.error(`Action '${actionId}' not found.`);
    process.exitCode = 1;
    return;
  }

  const pageId = action.pageId;
  if (!pageId) {
    console.error(`Action '${actionId}' has no associated page.`);
    process.exitCode = 1;
    return;
  }

  const storage = loader.storage();
  const snapshotNames = ['input', 'before', 'after'];
  let sha1: string | undefined;
  for (const name of snapshotNames) {
    const renderer = storage.snapshotByName(pageId, `${name}@${actionId}`);
    sha1 = renderer?.closestScreenshot();
    if (sha1)
      break;
  }

  if (!sha1) {
    console.error(`No screenshot found for action '${actionId}'.`);
    process.exitCode = 1;
    return;
  }

  const blob = await loader.resourceForSha1(sha1);
  if (!blob) {
    console.error(`Screenshot resource not found.`);
    process.exitCode = 1;
    return;
  }

  const outFile = options.output || `screenshot-${actionId.replace(/[^a-zA-Z0-9@]/g, '_')}.png`;
  const buffer = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(outFile, buffer);
  console.log(`  Screenshot saved to ${outFile}`);
}

// ---- trace attachments ----

export async function traceAttachments(traceFile: string, options: { save?: string, output?: string, json?: boolean }) {
  const { model, loader } = await loadTrace(traceFile);

  if (options.save) {
    const attachment = model.attachments.find(a => a.name === options.save);
    if (!attachment) {

      console.error(`Attachment '${options.save}' not found.`);
      process.exitCode = 1;
      return;
    }

    let content: Buffer | undefined;
    if (attachment.sha1) {
      const blob = await loader.resourceForSha1(attachment.sha1);
      if (blob)
        content = Buffer.from(await blob.arrayBuffer());
    } else if (attachment.base64) {
      content = Buffer.from(attachment.base64, 'base64');
    }

    if (!content) {

      console.error(`Could not extract attachment content.`);
      process.exitCode = 1;
      return;
    }

    const outFile = options.output || attachment.name;
    fs.writeFileSync(outFile, content);
    console.log(`  Attachment saved to ${outFile}`);
    return;
  }

  if (options.json) {
    const result = model.attachments.map(a => ({
      name: a.name,
      contentType: a.contentType,
      callId: a.callId,
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!model.attachments.length) {
    console.log('  No attachments');
    return;
  }
  console.log(`  ${padEnd('Name', 40)} ${padEnd('Content-Type', 30)} ${padEnd('Action', 15)}`);
  console.log(`  ${'─'.repeat(40)} ${'─'.repeat(30)} ${'─'.repeat(15)}`);
  for (const a of model.attachments)
    console.log(`  ${padEnd(a.name, 40)} ${padEnd(a.contentType, 30)} ${padEnd(a.callId, 15)}`);

}

// ---- trace info ----

export async function traceInfo(traceFile: string, options: { json?: boolean }) {
  const model = await loadTraceModel(traceFile);

  const info = {
    browser: model.browserName || 'unknown',
    platform: model.platform || 'unknown',
    playwrightVersion: model.playwrightVersion || 'unknown',
    title: model.title || '',
    duration: msToString(model.endTime - model.startTime),
    durationMs: model.endTime - model.startTime,
    startTime: model.wallTime ? new Date(model.wallTime).toISOString() : 'unknown',
    viewport: model.options.viewport ? `${model.options.viewport.width}x${model.options.viewport.height}` : 'default',
    actions: model.actions.length,
    pages: model.pages.length,
    network: model.resources.length,
    errors: model.errorDescriptors.length,
    attachments: model.attachments.length,
    consoleMessages: model.events.filter(e => e.type === 'console').length,
  };

  if (options.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  console.log('');
  console.log(`  Browser:      ${info.browser}`);
  console.log(`  Platform:     ${info.platform}`);
  console.log(`  Playwright:   ${info.playwrightVersion}`);
  if (info.title)
    console.log(`  Title:        ${info.title}`);
  console.log(`  Duration:     ${info.duration}`);
  console.log(`  Start time:   ${info.startTime}`);
  console.log(`  Viewport:     ${info.viewport}`);
  console.log(`  Actions:      ${info.actions}`);
  console.log(`  Pages:        ${info.pages}`);
  console.log(`  Network:      ${info.network} requests`);
  console.log(`  Errors:       ${info.errors}`);
  console.log(`  Attachments:  ${info.attachments}`);
  console.log(`  Console:      ${info.consoleMessages} messages`);
  console.log('');
}

// ---- install-skill ----

async function installSkill() {
  const cwd = process.cwd();
  const skillSource = path.join(__dirname, 'SKILL.md');
  const destDir = path.join(cwd, '.claude', 'playwright-trace');
  await fs.promises.mkdir(destDir, { recursive: true });
  const destFile = path.join(destDir, 'SKILL.md');
  await fs.promises.copyFile(skillSource, destFile);
  console.log(`✅ Skill installed to \`${path.relative(cwd, destFile)}\`.`);
}
