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

import { expect } from './expect';
import { currentlyLoadingFileSuite, currentTestInfo, setCurrentlyLoadingFileSuite } from './globals';
import { TestCase, Suite } from './test';
import { wrapFunctionWithLocation } from './transform';
import { Fixtures, FixturesWithLocation, Location, TestType } from './types';
import { errorWithLocation, serializeError } from './util';

const countByFile = new Map<string, number>();

export class DeclaredFixtures {
  testType!: TestTypeImpl;
  location!: Location;
}

export class TestTypeImpl {
  readonly fixtures: (FixturesWithLocation | DeclaredFixtures)[];
  readonly test: TestType<any, any>;

  constructor(fixtures: (FixturesWithLocation | DeclaredFixtures)[]) {
    this.fixtures = fixtures;

    const test: any = wrapFunctionWithLocation(this._createTest.bind(this, 'default'));
    test.expect = expect;
    test.only = wrapFunctionWithLocation(this._createTest.bind(this, 'only'));
    test.describe = wrapFunctionWithLocation(this._describe.bind(this, 'default'));
    test.describe.only = wrapFunctionWithLocation(this._describe.bind(this, 'only'));
    test.describe.parallel = wrapFunctionWithLocation(this._describe.bind(this, 'parallel'));
    test.describe.parallel.only = wrapFunctionWithLocation(this._describe.bind(this, 'parallel.only'));
    test.describe.serial = wrapFunctionWithLocation(this._describe.bind(this, 'serial'));
    test.describe.serial.only = wrapFunctionWithLocation(this._describe.bind(this, 'serial.only'));
    test.beforeEach = wrapFunctionWithLocation(this._hook.bind(this, 'beforeEach'));
    test.afterEach = wrapFunctionWithLocation(this._hook.bind(this, 'afterEach'));
    test.beforeAll = wrapFunctionWithLocation(this._hook.bind(this, 'beforeAll'));
    test.afterAll = wrapFunctionWithLocation(this._hook.bind(this, 'afterAll'));
    test.skip = wrapFunctionWithLocation(this._modifier.bind(this, 'skip'));
    test.fixme = wrapFunctionWithLocation(this._modifier.bind(this, 'fixme'));
    test.fail = wrapFunctionWithLocation(this._modifier.bind(this, 'fail'));
    test.slow = wrapFunctionWithLocation(this._modifier.bind(this, 'slow'));
    test.setTimeout = wrapFunctionWithLocation(this._setTimeout.bind(this));
    test.step = wrapFunctionWithLocation(this._step.bind(this));
    test.use = wrapFunctionWithLocation(this._use.bind(this));
    test.extend = wrapFunctionWithLocation(this._extend.bind(this));
    test.declare = wrapFunctionWithLocation(this._declare.bind(this));
    this.test = test;
  }

  private _createTest(type: 'default' | 'only' | 'skip', location: Location, title: string, fn: Function) {
    throwIfRunningInsideJest();
    const suite = currentlyLoadingFileSuite();
    if (!suite)
      throw errorWithLocation(location, `test() can only be called in a test file`);

    const ordinalInFile = countByFile.get(suite._requireFile) || 0;
    countByFile.set(suite._requireFile, ordinalInFile + 1);

    const test = new TestCase('test', title, fn, ordinalInFile, this, location);
    test._requireFile = suite._requireFile;
    suite._addTest(test);

    if (type === 'only')
      test._only = true;
    if (type === 'skip')
      test.expectedStatus = 'skipped';
  }

  private _describe(type: 'default' | 'only' | 'serial' | 'serial.only' | 'parallel' | 'parallel.only', location: Location, title: string, fn: Function) {
    throwIfRunningInsideJest();
    const suite = currentlyLoadingFileSuite();
    if (!suite)
      throw errorWithLocation(location, `describe() can only be called in a test file`);

    if (typeof title === 'function') {
      throw errorWithLocation(location, [
        'It looks like you are calling describe() without the title. Pass the title as a first argument:',
        `test.describe('my test group', () => {`,
        `  // Declare tests here`,
        `});`,
      ].join('\n'));
    }

    const child = new Suite(title);
    child._requireFile = suite._requireFile;
    child._isDescribe = true;
    child.location = location;
    suite._addSuite(child);

    if (type === 'only' || type === 'serial.only' || type === 'parallel.only')
      child._only = true;
    if (type === 'serial' || type === 'serial.only')
      child._parallelMode = 'serial';
    if (type === 'parallel' || type === 'parallel.only')
      child._parallelMode = 'parallel';

    for (let parent: Suite | undefined = suite; parent; parent = parent.parent) {
      if (parent._parallelMode === 'serial' && child._parallelMode === 'parallel')
        throw errorWithLocation(location, 'describe.parallel cannot be nested inside describe.serial');
      if (parent._parallelMode === 'parallel' && child._parallelMode === 'serial')
        throw errorWithLocation(location, 'describe.serial cannot be nested inside describe.parallel');
    }

    setCurrentlyLoadingFileSuite(child);
    fn();
    setCurrentlyLoadingFileSuite(suite);
  }

  private _hook(name: 'beforeEach' | 'afterEach' | 'beforeAll' | 'afterAll', location: Location, fn: Function) {
    const suite = currentlyLoadingFileSuite();
    if (!suite)
      throw errorWithLocation(location, `${name} hook can only be called in a test file`);
    if (name === 'beforeAll' || name === 'afterAll') {
      const sameTypeCount = suite._allHooks.filter(hook => hook._type === name).length;
      const suffix = sameTypeCount ? String(sameTypeCount) : '';
      const hook = new TestCase(name, name + suffix, fn, 0, this, location);
      hook._requireFile = suite._requireFile;
      suite._addAllHook(hook);
    } else {
      suite._eachHooks.push({ type: name, fn, location });
    }
  }

  private _modifier(type: 'skip' | 'fail' | 'fixme' | 'slow', location: Location, ...modifierArgs: [arg?: any | Function, description?: string]) {
    const suite = currentlyLoadingFileSuite();
    if (suite) {
      if (typeof modifierArgs[0] === 'string' && typeof modifierArgs[1] === 'function') {
        // Support for test.skip('title', () => {})
        this._createTest('skip', location, modifierArgs[0], modifierArgs[1]);
        return;
      }

      if (typeof modifierArgs[0] === 'function') {
        suite._modifiers.push({ type, fn: modifierArgs[0], location, description: modifierArgs[1] });
      } else {
        if (modifierArgs.length >= 1 && !modifierArgs[0])
          return;
        const description = modifierArgs[1];
        suite._annotations.push({ type, description });
      }
      return;
    }

    const testInfo = currentTestInfo();
    if (!testInfo)
      throw errorWithLocation(location, `test.${type}() can only be called inside test, describe block or fixture`);
    if (typeof modifierArgs[0] === 'function')
      throw errorWithLocation(location, `test.${type}() with a function can only be called inside describe block`);
    testInfo[type](...modifierArgs as [any, any]);
  }

  private _setTimeout(location: Location, timeout: number) {
    const suite = currentlyLoadingFileSuite();
    if (suite) {
      suite._timeout = timeout;
      return;
    }

    const testInfo = currentTestInfo();
    if (!testInfo)
      throw errorWithLocation(location, `test.setTimeout() can only be called from a test`);
    testInfo.setTimeout(timeout);
  }

  private _use(location: Location, fixtures: Fixtures) {
    const suite = currentlyLoadingFileSuite();
    if (!suite)
      throw errorWithLocation(location, `test.use() can only be called in a test file and can only be nested in test.describe()`);
    suite._use.push({ fixtures, location });
  }

  private async _step(location: Location, title: string, body: () => Promise<void>): Promise<void> {
    const testInfo = currentTestInfo();
    if (!testInfo)
      throw errorWithLocation(location, `test.step() can only be called from a test`);
    const step = testInfo._addStep({
      category: 'test.step',
      title,
      location,
      canHaveChildren: true,
      forceNoParent: false
    });
    try {
      await body();
      step.complete();
    } catch (e) {
      step.complete(serializeError(e));
      throw e;
    }
  }

  private _extend(location: Location, fixtures: Fixtures) {
    const fixturesWithLocation = { fixtures, location };
    return new TestTypeImpl([...this.fixtures, fixturesWithLocation]).test;
  }

  private _declare(location: Location) {
    const declared = new DeclaredFixtures();
    declared.location = location;
    const child = new TestTypeImpl([...this.fixtures, declared]);
    declared.testType = child;
    return child.test;
  }
}

function throwIfRunningInsideJest() {
  if (process.env.JEST_WORKER_ID) {
    throw new Error(
        `Playwright Test needs to be invoked via 'npx playwright test' and excluded from Jest test runs.\n` +
        `Creating one directory for Playwright tests and one for Jest is the recommended way of doing it.\n` +
        `See https://playwright.dev/docs/intro/ for more information about Playwright Test.`,
    );
  }
}

export const rootTestType = new TestTypeImpl([]);
