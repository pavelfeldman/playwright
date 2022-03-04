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

import { test as baseTest, Locator, Page } from '@playwright/test';

type Component = {
  type: string;
  props: Object;
  children: Object[];
};

declare global {
  interface Window {
    playwrightMount: (component: Component) => Promise<string>;
  }
}

type TestFixtures = {
  mount: (component: any) => Promise<Locator>;
  webpack: string;
};

export const test = baseTest.extend<TestFixtures>({
  mount: async ({ page, baseURL }, use) => {
    await use(async (component: Component) => {
      await page.goto(baseURL!);
      const callbacks: Function[] = [];
      wrapFunctions(component, page, callbacks);

      await page.exposeFunction('__pw_dispatch_', (ordinal: number, args: any[]) => {
        callbacks[ordinal](...args);
      });

      await page.evaluate(async v => {
        const unwrapFunctions = (object: any) => {
          for (const [key, value] of Object.entries(object)) {
            if (typeof value === 'string' && (value as string).startsWith('__pw_func_')) {
              const ordinal = +value.substring('__pw_func_'.length);
              object[key] = (...args: any[]) => {
                (window as any).__pw_dispatch_(ordinal, args);
              };
            } else if (typeof value === 'object' && value) {
              unwrapFunctions(value);
            }
          }
        };

        unwrapFunctions(v);
        await window.playwrightMount(v);
      }, component);
      return page.locator('#app');
    });
  },
});

export function wrapFunctions(object: any, page: Page, callbacks: Function[]) {
  for (const [key, value] of Object.entries(object)) {
    const type = typeof value;
    if (type === 'function') {
      const functionName = '__pw_func_' + callbacks.length;
      callbacks.push(value as Function);
      object[key] = functionName;
    } else if (type === 'object' && value) {
      wrapFunctions(value, page, callbacks);
    }
  }
}

export { expect } from '@playwright/test';
