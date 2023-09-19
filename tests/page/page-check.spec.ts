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

import { test } from './pageTest';
import type { Locator, Page } from '@playwright/test';
import { expect as baseExpect } from '@playwright/test';
import { colors } from 'playwright-core/lib/utilsBundle';

// it('should check the box @smoke', async ({ page }) => {
//   await page.setContent(`<input id='checkbox' type='checkbox'></input>`);
//   await page.check('input');
//   expect(await page.evaluate(() => window['checkbox'].checked)).toBe(true);
// });

// it('should not check the checked box', async ({ page }) => {
//   await page.setContent(`<input id='checkbox' type='checkbox' checked></input>`);
//   await page.check('input');
//   expect(await page.evaluate(() => window['checkbox'].checked)).toBe(true);
// });

// it('should uncheck the box', async ({ page }) => {
//   await page.setContent(`<input id='checkbox' type='checkbox' checked></input>`);
//   await page.uncheck('input');
//   expect(await page.evaluate(() => window['checkbox'].checked)).toBe(false);
// });

// it('should not uncheck the unchecked box', async ({ page }) => {
//   await page.setContent(`<input id='checkbox' type='checkbox'></input>`);
//   await page.uncheck('input');
//   expect(await page.evaluate(() => window['checkbox'].checked)).toBe(false);
// });

// it('should check radio', async ({ page }) => {
//   await page.setContent(`
//     <input type='radio'>one</input>
//     <input id='two' type='radio'>two</input>
//     <input type='radio'>three</input>`);
//   await page.check('#two');
//   expect(await page.evaluate(() => window['two'].checked)).toBe(true);
// });

// it('should check radio by aria role', async ({ page }) => {
//   await page.setContent(`<div role='radio' id='checkbox'>CHECKBOX</div>
//     <script>
//       checkbox.addEventListener('click', () => checkbox.setAttribute('aria-checked', 'true'));
//     </script>`);
//   await page.check('div');
//   expect(await page.evaluate(() => window['checkbox'].getAttribute('aria-checked'))).toBe('true');
// });

// it('should uncheck radio by aria role', async ({ page }) => {
//   await page.setContent(`<div role='radio' id='checkbox' aria-checked="true">CHECKBOX</div>
//     <script>
//       checkbox.addEventListener('click', () => checkbox.setAttribute('aria-checked', 'false'));
//     </script>`);
//   await page.uncheck('div');
//   expect(await page.evaluate(() => window['checkbox'].getAttribute('aria-checked'))).toBe('false');
// });

// it('should check the box by aria role', async ({ page }) => {
//   for (const role of ['checkbox', 'menuitemcheckbox', 'option', 'radio', 'switch', 'menuitemradio', 'treeitem']) {
//     await it.step(`role=${role}`, async () => {
//       await page.setContent(`<div role='${role}' id='checkbox'>CHECKBOX</div>
//         <script>
//           checkbox.addEventListener('click', () => checkbox.setAttribute('aria-checked', 'true'));
//         </script>`);
//       await page.check('div');
//       expect(await page.evaluate(() => window['checkbox'].getAttribute('aria-checked'))).toBe('true');
//     });
//   }
// });

// it('should uncheck the box by aria role', async ({ page }) => {
//   for (const role of ['checkbox', 'menuitemcheckbox', 'option', 'radio', 'switch', 'menuitemradio', 'treeitem']) {
//     await it.step(`role=${role}`, async () => {
//       await page.setContent(`<div role='${role}' id='checkbox' aria-checked="true">CHECKBOX</div>
//         <script>
//           checkbox.addEventListener('click', () => checkbox.setAttribute('aria-checked', 'false'));
//         </script>`);
//       await page.uncheck('div');
//       expect(await page.evaluate(() => window['checkbox'].getAttribute('aria-checked'))).toBe('false');
//     });
//   }
// });

// it('should throw when not a checkbox', async ({ page }) => {
//   await page.setContent(`<div>Check me</div>`);
//   const error = await page.check('div').catch(e => e);
//   expect(error.message).toContain('Not a checkbox or radio button');
// });

// it('should throw when not a checkbox 2', async ({ page }) => {
//   await page.setContent(`<div role=button>Check me</div>`);
//   const error = await page.check('div').catch(e => e);
//   expect(error.message).toContain('Not a checkbox or radio button');
// });

// it('should check the box inside a button', async ({ page }) => {
//   await page.setContent(`<div role='button'><input type='checkbox'></div>`);
//   await page.check('input');
//   expect(await page.$eval('input', input => input.checked)).toBe(true);
//   expect(await page.isChecked('input')).toBe(true);
//   expect(await (await page.$('input')).isChecked()).toBe(true);
// });

// it('should check the label with position', async ({ page, server }) => {
//   await page.setContent(`
//     <input id='checkbox' type='checkbox' style='width: 5px; height: 5px;'>
//     <label for='checkbox'>
//       <a href=${JSON.stringify(server.EMPTY_PAGE)}>I am a long link that goes away so that nothing good will happen if you click on me</a>
//       Click me
//     </label>`);
//   const box = await (await page.$('text=Click me')).boundingBox();
//   await page.check('text=Click me', { position: { x: box.width - 10, y: 2 } });
//   expect(await page.$eval('input', input => input.checked)).toBe(true);
// });

// it('trial run should not check', async ({ page }) => {
//   await page.setContent(`<input id='checkbox' type='checkbox'></input>`);
//   await page.check('input', { trial: true });
//   expect(await page.evaluate(() => window['checkbox'].checked)).toBe(false);
// });

// it('trial run should not uncheck', async ({ page }) => {
//   await page.setContent(`<input id='checkbox' type='checkbox' checked></input>`);
//   await page.uncheck('input', { trial: true });
//   expect(await page.evaluate(() => window['checkbox'].checked)).toBe(true);
// });

// it('should check the box using setChecked', async ({ page }) => {
//   await page.setContent(`<input id='checkbox' type='checkbox'></input>`);
//   await page.setChecked('input', true);
//   expect(await page.evaluate(() => window['checkbox'].checked)).toBe(true);
//   await page.setChecked('input', false);
//   expect(await page.evaluate(() => window['checkbox'].checked)).toBe(false);
// });

// const expectCheckboxes = expect.wrap('expectCheckboxes', async (page: Page, count: number) => {
//   await expect(page.locator('input')).toHaveCount(count);
// });

function callLogText(log: string[] | undefined): string {
  if (!log)
    return '';
  return `
Call log:
  ${colors.dim('- ' + (log || []).join('\n  - '))}
`;
}

type Matchers = {
  toHaveAmount: (locator: Locator, expected: string, options?: { timeout?: number }) => Promise<void>;
  toBeANicePage: (page: Page) => Promise<void>;
};

const expect = baseExpect.extend<Matchers>({
  async toHaveAmount(locator: Locator, expected: string, options?: { timeout?: number }) {
    const baseAmount = locator.locator('.base-amount');

    let pass: boolean;
    let matcherResult: any;
    try {
      await baseExpect(baseAmount).toHaveAttribute('data-amount', expected, options);
      pass = true;
    } catch (e) {
      matcherResult = e.matcherResult;
      pass = false;
    }

    const expectOptions = {
      isNot: this.isNot,
      promise: this.promise,
    };

    const log = callLogText(matcherResult?.log);
    const message = pass
      ? () => this.utils.matcherHint('toBe', locator, expected, expectOptions) +
          '\n\n' +
          `Expected: ${this.isNot ? 'not' : ''}${this.utils.printExpected(expected)}\n` +
          (matcherResult ? `Received: ${this.utils.printReceived(matcherResult.actual)}` : '') +
          log
      : () =>  this.utils.matcherHint('toBe', locator, expected, expectOptions) +
          '\n\n' +
          `Expected: ${this.utils.printExpected(expected)}\n` +
          (matcherResult ? `Received: ${this.utils.printReceived(matcherResult.actual)}` : '') +
          log;

    return {
      locator,
      name: 'toHaveAmount',
      expected,
      message,
      pass,
      actual: matcherResult?.actual,
      log: matcherResult?.log,
    };
  },

  async toBeANicePage(page: Page) {
    return {
      name: 'toBeANicePage',
      expected: 1,
      message: () => '',
      pass: true,
    };
  }
});

test.only('checkboxes', async ({ page }) => {
  await page.setContent(`
    <div>
      <div class='base-amount' data-amount='2'></div>
    </div>
  `);
  await expect(page.locator('div')).toHaveAmount('3', { timeout: 1000 });
  await expect(page).toBeANicePage();
});
