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

import { browserTest as it, expect } from './config/browserTest';
import fs from 'fs';

async function checkFeatures(name: string, context: any, server: any) {
  try {
    const page = await context.newPage();
    await page.goto(server.PREFIX + '/modernizr.html');
    const actual = await page.evaluate('window.report');
    const expected = JSON.parse(fs.readFileSync(require.resolve(`./assets/modernizr/${name}.json`), 'utf-8'));
    return { actual, expected };
  } finally {
    await context.close();
  }
}

it('safari-14-1', async ({ browser, browserName, platform, server, headless }) => {
  it.skip(browserName !== 'webkit' ||  platform === 'win32');
  const context = await browser.newContext({
    deviceScaleFactor: 2
  });
  let { actual, expected } = await checkFeatures('safari-14-1', context, server);

  if (platform === 'linux') {
    expected.subpixelfont = false;

    if (headless) {
      expected.inputtypes.color = false;
      expected.inputtypes.date = false;
      expected.inputtypes['datetime-local'] = false;
      expected.inputtypes.time = false;
      expected.todataurljpeg = false;
    } else {
      expected.inputtypes.month = true;
      expected.inputtypes.week = true;
    }
  }

  expect(actual).toEqual(expected);
});

it('mobile-safari-14-1', async ({ playwright, browser, browserName, platform, server, headless }) => {
  it.skip(browserName !== 'webkit' || platform === 'win32');
  const iPhone = playwright.devices['iPhone 12'];
  const context = await browser.newContext(iPhone);
  let { actual, expected } = await checkFeatures('mobile-safari-14-1', context, server);

  if (platform === 'darwin' || platform === 'linux') {
    expected.capture = false;
    expected.cssscrollbar = true;
    expected.cssvhunit = true;
    expected.cssvmaxunit = true;
    expected.overflowscrolling = false;
  }

  if (platform === 'linux') {
    expected.subpixelfont = false;

    if (headless) {
      expected.inputtypes.color = false;
      expected.inputtypes.date = false;
      expected.inputtypes['datetime-local'] = false;
      expected.inputtypes.month = false;
      expected.inputtypes.week = false;
      expected.inputtypes.time = false;
      expected.todataurljpeg = false;
    }
  }

  expect(actual).toEqual(expected);
});
