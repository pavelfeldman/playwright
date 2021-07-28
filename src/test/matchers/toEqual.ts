/**
 * Copyright Microsoft Corporation. All rights reserved.
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

import { equals } from 'expect/build/jasmineUtils';
import matchers from 'expect/build/matchers';
import {
  iterableEquality
} from 'expect/build/utils';
import {
  matcherHint, MatcherHintOptions,
  printDiffOrStringify,
  printExpected,
  printReceived,
  stringify
} from 'jest-matcher-utils';
import { Locator } from '../../..';
import { currentTestInfo } from '../globals';
import type { Expect } from '../types';
import { expectLocator, monotonicTime, pollUntilDeadline } from '../util';

// Omit colon and one or more spaces, so can call getLabelPrinter.
const EXPECTED_LABEL = 'Expected';
const RECEIVED_LABEL = 'Received';

// The optional property of matcher context is true if undefined.
const isExpand = (expand?: boolean): boolean => expand !== false;

async function toEqualImpl<T>(
  this: ReturnType<Expect['getState']>,
  matcherName: string,
  locator: Locator,
  query: (timeout: number) => Promise<T>,
  expected: T,
  options: { timeout?: number } = {},
) {
  const testInfo = currentTestInfo();
  if (!testInfo)
    throw new Error(`${matcherName} must be called during the test`);
  expectLocator(locator, matcherName);

  const matcherOptions: MatcherHintOptions = {
    comment: 'deep equality',
    isNot: this.isNot,
    promise: this.promise,
  };

  let received: T | undefined = undefined;
  let pass = false;
  const timeout = options.timeout === 0 ? 0 : options.timeout || testInfo.timeout;
  const deadline = timeout ? monotonicTime() + timeout : 0;

  // TODO: interrupt on timeout for nice message.
  await pollUntilDeadline(async () => {
    const remainingTime = deadline ? deadline - monotonicTime() : 0;
    received = await query(remainingTime);
    pass = equals(received, expected, [iterableEquality]);
    return pass === !matcherOptions.isNot;
  }, deadline, 100);

  const message = pass
    ? () =>
      matcherHint(matcherName, undefined, undefined, matcherOptions) +
      '\n\n' +
      `Expected: not ${printExpected(expected)}\n` +
      (stringify(expected) !== stringify(received)
        ? `Received:     ${printReceived(received)}`
        : '')
    : () =>
      matcherHint(matcherName, undefined, undefined, matcherOptions) +
      '\n\n' +
      printDiffOrStringify(
          expected,
          received,
          EXPECTED_LABEL,
          RECEIVED_LABEL,
          isExpand(this.expand),
      );

  // Passing the actual and expected objects so that a custom reporter
  // could access them, for example in order to display a custom visual diff,
  // or create a different error message
  return { actual: received, expected, message, name: matcherName, pass };
}

export async function toHaveLength(
  this: ReturnType<Expect['getState']>,
  locator: Locator,
  expected: number,
  options?: { timeout?: number },
) {
  if (typeof locator !== 'object' || locator.constructor.name !== 'Locator')
    return matchers.toHaveLength.call(this, locator, expected);
  return toEqualImpl.call(this, 'toHaveLength', locator, async timeout => {
    return await locator.count();
  }, expected, { expectedType: 'number', ...options });
}

export async function toHaveProp(
  this: ReturnType<Expect['getState']>,
  locator: Locator,
  name: string,
  expected: number,
  options?: { timeout?: number },
) {
  return toEqualImpl.call(this, 'toHaveProp', locator, async timeout => {
    return await locator.evaluate((element, name) => (element as any)[name], name, { timeout });
  }, expected, { expectedType: 'number', ...options });
}
