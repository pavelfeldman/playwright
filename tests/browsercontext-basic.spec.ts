/**
 * Copyright 2018 Google Inc. All rights reserved.
 * Modifications copyright (c) Microsoft Corporation.
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

import { browserTest as it, expect } from './config/browserTest';
import { attachFrame, verifyViewport } from './config/utils';

it('should create new context', async function({ browser }) {
  expect(browser.contexts().length).toBe(0);
  const context = await browser.newContext();
  expect(browser.contexts().length).toBe(1);
  expect(browser.contexts().indexOf(context) !== -1).toBe(true);
  expect(browser).toBe(context.browser());
  await context.close();
  expect(browser.contexts().length).toBe(0);
  expect(browser).toBe(context.browser());
});

it('window.open should use parent tab context', async function({ browser, server }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(server.EMPTY_PAGE);
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.evaluate(url => window.open(url), server.EMPTY_PAGE)
  ]);
  expect(popup.context()).toBe(context);
  await context.close();
});

it('should isolate localStorage and cookies', async function({ browser, server }) {
  // Create two incognito contexts.
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  expect(context1.pages().length).toBe(0);
  expect(context2.pages().length).toBe(0);

  // Create a page in first incognito context.
  const page1 = await context1.newPage();
  await page1.goto(server.EMPTY_PAGE);
  await page1.evaluate(() => {
    localStorage.setItem('name', 'page1');
    document.cookie = 'name=page1';
  });

  expect(context1.pages().length).toBe(1);
  expect(context2.pages().length).toBe(0);

  // Create a page in second incognito context.
  const page2 = await context2.newPage();
  await page2.goto(server.EMPTY_PAGE);
  await page2.evaluate(() => {
    localStorage.setItem('name', 'page2');
    document.cookie = 'name=page2';
  });

  expect(context1.pages().length).toBe(1);
  expect(context2.pages().length).toBe(1);
  expect(context1.pages()[0]).toBe(page1);
  expect(context2.pages()[0]).toBe(page2);

  // Make sure pages don't share localstorage or cookies.
  expect(await page1.evaluate(() => localStorage.getItem('name'))).toBe('page1');
  expect(await page1.evaluate(() => document.cookie)).toBe('name=page1');
  expect(await page2.evaluate(() => localStorage.getItem('name'))).toBe('page2');
  expect(await page2.evaluate(() => document.cookie)).toBe('name=page2');

  // Cleanup contexts.
  await Promise.all([
    context1.close(),
    context2.close()
  ]);
  expect(browser.contexts().length).toBe(0);
});

it('should propagate default viewport to the page', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 456, height: 789 } });
  const page = await context.newPage();
  await verifyViewport(page, 456, 789);
  await context.close();
});

it('should make a copy of default viewport', async ({ browser }) => {
  const viewport = { width: 456, height: 789 };
  const context = await browser.newContext({ viewport });
  viewport.width = 567;
  const page = await context.newPage();
  await verifyViewport(page, 456, 789);
  await context.close();
});

it('should respect deviceScaleFactor', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 3 });
  const page = await context.newPage();
  expect(await page.evaluate('window.devicePixelRatio')).toBe(3);
  await context.close();
});

it('should not allow deviceScaleFactor with null viewport', async ({ browser }) => {
  const error = await browser.newContext({ viewport: null, deviceScaleFactor: 1 }).catch(e => e);
  expect(error.message).toContain('"deviceScaleFactor" option is not supported with null "viewport"');
});

it('should not allow isMobile with null viewport', async ({ browser }) => {
  const error = await browser.newContext({ viewport: null, isMobile: true }).catch(e => e);
  expect(error.message).toContain('"isMobile" option is not supported with null "viewport"');
});

it('close() should work for empty context', async ({ browser }) => {
  const context = await browser.newContext();
  await context.close();
});

it('close() should abort waitForEvent', async ({ browser }) => {
  const context = await browser.newContext();
  const promise = context.waitForEvent('page').catch(e => e);
  await context.close();
  const error = await promise;
  expect(error.message).toContain('Context closed');
});

it('close() should be callable twice', async ({ browser }) => {
  const context = await browser.newContext();
  await Promise.all([
    context.close(),
    context.close(),
  ]);
  await context.close();
});

it('should pass self to close event', async ({ browser }) => {
  const newContext = await browser.newContext();
  const [closedContext] = await Promise.all([
    newContext.waitForEvent('close'),
    newContext.close()
  ]);
  expect(closedContext).toBe(newContext);
});

it('should not report frameless pages on error', async ({ browser, server }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  server.setRoute('/empty.html', (req, res) => {
    res.end(`<a href="${server.EMPTY_PAGE}" target="_blank">Click me</a>`);
  });
  let popup;
  context.on('page', p => popup = p);
  await page.goto(server.EMPTY_PAGE);
  await page.click('"Click me"');
  await context.close();
  if (popup) {
    // This races on Firefox :/
    expect(popup.isClosed()).toBeTruthy();
    expect(popup.mainFrame()).toBeTruthy();
  }
});

it('should return all of the pages', async ({ browser, server }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const second = await context.newPage();
  const allPages = context.pages();
  expect(allPages.length).toBe(2);
  expect(allPages).toContain(page);
  expect(allPages).toContain(second);
  await context.close();
});

it('should close all belonging pages once closing context', async function({ browser }) {
  const context = await browser.newContext();
  await context.newPage();
  expect(context.pages().length).toBe(1);

  await context.close();
  expect(context.pages().length).toBe(0);
});

it('should disable javascript', async ({ browser, browserName }) => {
  {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('data:text/html, <script>var something = "forbidden"</script>');
    let error = null;
    await page.evaluate('something').catch(e => error = e);
    if (browserName === 'webkit')
      expect(error.message).toContain('Can\'t find variable: something');
    else
      expect(error.message).toContain('something is not defined');
    await context.close();
  }

  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('data:text/html, <script>var something = "forbidden"</script>');
    expect(await page.evaluate('something')).toBe('forbidden');
    await context.close();
  }
});

it('should be able to navigate after disabling javascript', async ({ browser, server }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(server.EMPTY_PAGE);
  await context.close();
});

it('should not hang on promises after disabling javascript', async ({ browserName, contextFactory }) => {
  it.fixme(browserName === 'webkit' || browserName === 'firefox');
  const context = await contextFactory({ javaScriptEnabled: false });
  const page = await context.newPage();
  expect(await page.evaluate(() => 1)).toBe(1);
  expect(await page.evaluate(async () => 2)).toBe(2);
});

it('should work with offline option', async ({ browser, server }) => {
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage();
  let error = null;
  await page.goto(server.EMPTY_PAGE).catch(e => error = e);
  expect(error).toBeTruthy();
  await context.setOffline(false);
  const response = await page.goto(server.EMPTY_PAGE);
  expect(response.status()).toBe(200);
  await context.close();
});

it('should emulate navigator.onLine', async ({ browser, server }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  expect(await page.evaluate(() => window.navigator.onLine)).toBe(true);
  await context.setOffline(true);
  expect(await page.evaluate(() => window.navigator.onLine)).toBe(false);
  await context.setOffline(false);
  expect(await page.evaluate(() => window.navigator.onLine)).toBe(true);
  await context.close();
});

it('should emulate media in popup', async ({ browser, server }) => {
  {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto(server.EMPTY_PAGE);
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.evaluate(url => { window.open(url); }, server.EMPTY_PAGE),
    ]);
    expect(await popup.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches)).toBe(false);
    expect(await popup.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    await context.close();
  }
  {
    const page = await browser.newPage({ colorScheme: 'light' });
    await page.goto(server.EMPTY_PAGE);
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.evaluate(url => { window.open(url); }, server.EMPTY_PAGE),
    ]);
    expect(await popup.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches)).toBe(true);
    expect(await popup.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(false);
    await page.close();
  }
});

it('should emulate media in cross-process iframe', async ({ browser, server }) => {
  const page = await browser.newPage({ colorScheme: 'dark' });
  await page.goto(server.EMPTY_PAGE);
  await attachFrame(page, 'frame1', server.CROSS_PROCESS_PREFIX + '/empty.html');
  const frame = page.frames()[1];
  expect(await frame.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
  await page.close();
});
