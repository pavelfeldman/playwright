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

import type { FullResult } from 'packages/playwright-test/reporter';
import { showTraceViewer, serverSideCallMetadata } from 'playwright-core/lib/server';
import { clearCompilationCache } from '../common/compilationCache';
import type { FullConfigInternal } from '../common/types';
import ListReporter from '../reporters/list';
import { Multiplexer } from '../reporters/multiplexer';
import { TeleReporterEmitter } from '../reporters/teleEmitter';
import { createTaskRunnerForList, createTaskRunnerForWatch, createTaskRunnerForWatchSetup } from './tasks';
import type { TaskRunnerState } from './tasks';
import { createReporter } from './reporters';
import { FSWatcher } from './fsWatcher';
import { ManualPromise } from 'playwright-core/lib/utils';

export async function runUIMode(config: FullConfigInternal): Promise<FullResult['status']> {
  // Reset the settings that don't apply to watch.
  config._internal.passWithNoTests = true;
  config._internal.configCLIOverrides.use = config._internal.configCLIOverrides.use || {};
  config._internal.configCLIOverrides.use.trace = 'on';

  for (const p of config.projects)
    p.retries = 0;

  // Global setup.
  const reporter = await createReporter(config, 'watch');
  const taskRunner = createTaskRunnerForWatchSetup(config, reporter);
  reporter.onConfigure(config);
  const context: TaskRunnerState = {
    config,
    reporter,
    phases: [],
  };
  const { status, cleanup: globalCleanup } = await taskRunner.runDeferCleanup(context, 0);
  if (status !== 'passed')
    return await globalCleanup();

  // Show trace viewer.
  const page = await showTraceViewer([], 'chromium', { watchMode: true });
  await page.mainFrame()._waitForFunctionExpression(serverSideCallMetadata(), '!!window.dispatch', false, undefined, { timeout: 0 });

  // Create transport.
  const teleTransport = (message: any) => {
    const func = (message: any) => {
      (window as any).dispatch(message);
    };
    // eslint-disable-next-line no-console
    page.mainFrame().evaluateExpression(String(func), true, message).catch(e => console.log(e));
  };

  // List
  {
    const teleReporter = new TeleReporterEmitter(teleTransport);
    const reporter = new Multiplexer([teleReporter]);
    const taskRunner = createTaskRunnerForList(config, reporter);
    const context: TaskRunnerState = {
      config,
      reporter,
      phases: [],
    };
    reporter.onConfigure(config);
    const { status, cleanup: globalCleanup } = await taskRunner.runDeferCleanup(context, 0);
    if (status !== 'passed')
      return await globalCleanup();
    await taskRunner.run(context, 0);
  }

  // Start listening to the commands from the UI.
  let readCommandPromise: ManualPromise<{ method: string, params: any }>;
  await page.exposeBinding('binding', false, (source, data) => {
    readCommandPromise.resolve(data);
  });

  // Prepare projects that will be watched, set up watcher.
  const failedTestIdCollector = new Set<string>();
  const fsWatcher = new FSWatcher();
  await fsWatcher.update(config);

  let stopPromise: ManualPromise<void> | undefined;

  while (true) {
    readCommandPromise = new ManualPromise();
    await Promise.race([
      fsWatcher.onDirtyTestFiles(),
      readCommandPromise,
    ]);
    if (!readCommandPromise.isDone())
      readCommandPromise.resolve({ method: 'changed', params: {} });

    const { method, params } = await readCommandPromise;

    if (method === 'changed') {
      const dirtyTestFiles = fsWatcher.takeDirtyTestFiles();
      // Resolve files that depend on the changed files.
      // await runChangedTests(config, failedTestIdCollector, dirtyTestFiles);
      continue;
    }

    if (method === 'run') {
      const { location, testIds } = params;
      if (location) {
        config._internal.cliArgs = [location];
        config._internal.testIdMatcher = undefined;
      }
      if (testIds) {
        const testIdSet = testIds ? new Set<string>(testIds) : null;
        config._internal.cliArgs = [];
        config._internal.testIdMatcher = id => !testIdSet || testIdSet.has(id);
      }
      stopPromise = new ManualPromise();
      runTests(config, teleTransport, failedTestIdCollector, stopPromise);
      continue;
    }

    if (method === 'stop') {
      stopPromise?.resolve();
      continue;
    }

    if (method === 'exit')
      break;
  }

  return await globalCleanup();
}

async function runTests(config: FullConfigInternal, teleTransport: (message: any) => void, failedTestIdCollector: Set<string>, stopPromise: ManualPromise<void>) {
  const teleReporter = new TeleReporterEmitter(teleTransport);
  const reporter = new Multiplexer([new ListReporter(), teleReporter]);
  const taskRunner = createTaskRunnerForWatch(config, reporter);
  const context: TaskRunnerState = {
    config,
    reporter,
    phases: [],
  };
  clearCompilationCache();
  reporter.onConfigure(config);
  const taskStatus = await taskRunner.run(context, 0, stopPromise);
  let status: FullResult['status'] = 'passed';

  let hasFailedTests = false;
  for (const test of context.rootSuite?.allTests() || []) {
    if (test.outcome() === 'unexpected') {
      failedTestIdCollector.add(test.id);
      hasFailedTests = true;
    } else {
      failedTestIdCollector.delete(test.id);
    }
  }

  if (context.phases.find(p => p.dispatcher.hasWorkerErrors()) || hasFailedTests)
    status = 'failed';
  if (status === 'passed' && taskStatus !== 'passed')
    status = taskStatus;
  await reporter.onExit({ status });
}
