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

import path from 'path';
import type { Browser,Locator,  Page } from '../../index';
import { showTraceViewer } from '../../lib/server/trace/viewer/traceViewer';
import { playwrightTest } from '../config/browserTest';
import { expect } from '../config/test-runner';

class TraceViewerPage {
  actionTitles: Locator;
  callLines: Locator;
  consoleLines: Locator;
  consoleLineMessages: Locator;
  consoleStacks: Locator;
  consoleTab: Locator;

  constructor(public page: Page) {
    this.actionTitles = page.locator('.action-title');
    this.callLines = page.locator('.call-line');
    this.consoleLines = page.locator('.console-line');
    this.consoleLineMessages = page.locator('.console-line-message');
    this.consoleStacks = page.locator('.console-stack');
    this.consoleTab = page.locator('.console-tab');
  }

  actionIconValues(action: string) {
    return this.page.locator('.action-icon-value');
  }

  actionIcons(action: string) {
    return this.page.locator(`.action-entry:has-text("${action}") .action-icons`);
  }

  actionTitle(title: string) {
    return this.page.locator(`.action-title:has-text("${title}")`);
  }

  async eventBars() {
    const list = await this.page.$$eval('.timeline-bar.event:visible', ee => ee.map(e => e.className));
    const set = new Set<string>();
    for (const item of list) {
      for (const className of item.split(' '))
        set.add(className);
    }
    const result = [...set];
    return result.sort();
  }
}

const test = playwrightTest.extend<{ showTraceViewer: (trace: string) => Promise<TraceViewerPage> }>({
  showTraceViewer: async ({ playwright, browserName, headless }, use) => {
    let browser: Browser;
    let contextImpl: any;
    await use(async (trace: string) => {
      contextImpl = await showTraceViewer(trace, browserName, headless);
      browser = await playwright.chromium.connectOverCDP(contextImpl._browser.options.wsEndpoint);
      return new TraceViewerPage(browser.contexts()[0].pages()[0]);
    });
    await browser.close();
    await contextImpl._browser.close();
  }
});

let traceFile: string;

test.beforeAll(async ({ browser, browserName }, workerInfo) => {
  const context = await browser.newContext();
  await context.tracing.start({ name: 'test', screenshots: true, snapshots: true });
  const page = await context.newPage();
  await page.goto('data:text/html,<html>Hello world</html>');
  await page.setContent('<button>Click</button>');
  await page.evaluate(({ a }) => {
    console.log('Info');
    console.warn('Warning');
    console.error('Error');
    setTimeout(() => { throw new Error('Unhandled exception'); }, 0);
    return 'return ' + a;
  }, { a: 'paramA', b: 4 });
  await page.click('"Click"');
  await Promise.all([
    page.waitForNavigation(),
    page.waitForTimeout(200).then(() => page.goto('data:text/html,<html>Hello world 2</html>'))
  ]);
  await page.close();
  traceFile = path.join(workerInfo.project.outputDir, browserName, 'trace.zip');
  await context.tracing.stop({ path: traceFile });
});

test('should show empty trace viewer', async ({ showTraceViewer }, testInfo) => {
  const traceViewer = await showTraceViewer(testInfo.outputPath());
  expect(await traceViewer.page.title()).toBe('Playwright Trace Viewer');
});

test('should open simple trace viewer', async ({ showTraceViewer }) => {
  const traceViewer = await showTraceViewer(traceFile);
  await expect(traceViewer.actionTitles).toHaveText([
    'page.gotodata:text/html,<html>Hello world</html>',
    'page.setContent',
    'page.evaluate',
    'page.click\"Click\"',
    'page.waitForNavigation',
    'page.gotodata:text/html,<html>Hello world 2</html>',
  ]);
});

test('should contain action info', async ({ showTraceViewer }) => {
  const traceViewer = await showTraceViewer(traceFile);
  await traceViewer.actionTitle('page.click').click();
  const logLines = await traceViewer.callLines.allTextContents();
  expect(logLines.length).toBeGreaterThan(10);
  expect(logLines).toContain('attempting click action');
  expect(logLines).toContain('  click action done');
});

test('should render events', async ({ showTraceViewer }) => {
  const traceViewer = await showTraceViewer(traceFile);
  const events = await traceViewer.eventBars();
  expect(events).toContain('page_console');
});

test('should render console', async ({ showTraceViewer, browserName }) => {
  test.fixme(browserName === 'firefox', 'Firefox generates stray console message for page error');
  const traceViewer = await showTraceViewer(traceFile);
  await traceViewer.actionTitle('page.evaluate').click();
  await traceViewer.page.click('"Console"');

  await expect(traceViewer.consoleLineMessages).toHaveText([
    'Info',
    'Warning',
    'Error',
    'Unhandled exception'
  ]);

  await expect(traceViewer.consoleLines).toHaveClass([
    'console-line log',
    'console-line warning',
    'console-line error',
    'console-line error'
  ]);

  await expect(traceViewer.consoleStacks).toHaveCount(1);
  await expect(traceViewer.consoleStacks.first()).toContainText('Error: Unhandled exception');
});

test('should open console errors on click', async ({ showTraceViewer, browserName }) => {
  test.fixme(browserName === 'firefox', 'Firefox generates stray console message for page error');
  const traceViewer = await showTraceViewer(traceFile);
  await expect(traceViewer.actionIconValues('page.evaluate')).toHaveText(['2', '1']);
  await expect(traceViewer.consoleTab).toBeHidden();
  await traceViewer.actionIcons('page.evaluate').click();
  await expect(traceViewer.consoleTab).toBeVisible();
});

test('should show params and return value', async ({ showTraceViewer, browserName }) => {
  const traceViewer = await showTraceViewer(traceFile);
  await traceViewer.actionTitle('page.evaluate').click();
  await expect(traceViewer.callLines).toHaveText([
    'page.evaluate',
    'expression: "({↵    a↵  }) => {↵    console.log(\'Info\');↵    console.warn(\'Warning\');↵    con…"',
    'isFunction: true',
    'arg: {"a":"paramA","b":4}',
    'value: "return paramA"'
  ]);
});
