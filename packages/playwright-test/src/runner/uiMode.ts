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

  // Set up transport.
  const teleReporter = new TeleReporterEmitter((message: any) => {
    const func = (message: any) => {
      (window as any).dispatch(message);
    };
    // eslint-disable-next-line no-console
    page.mainFrame().evaluateExpression(String(func), true, message).catch(e => console.log(e));
  });
  await page.exposeBinding('binding', false, (source, data) => {
    const { method, params } = data;
    if (method === 'run') {
      const { location, testIds } = params;
      if (location)
        config._internal.cliArgs = [location];
      if (testIds) {
        const testIdSet = testIds ? new Set<string>(testIds) : null;
        config._internal.testIdMatcher = id => !testIdSet || testIdSet.has(id);
      }
      runTests(config, teleReporter, failedTestIdCollector);
    }
  });

  // List
  {
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

  // Prepare projects that will be watched, set up watcher.
  const failedTestIdCollector = new Set<string>();
  const fsWatcher = new FSWatcher();
  await fsWatcher.update(config);

  let result: FullResult['status'] = 'passed';

  while (true) {
    const readCommandPromise = new ManualPromise<Command>();
    await Promise.race([
      fsWatcher.onDirtyTestFiles(),
      readCommandPromise,
    ]);
    if (!readCommandPromise.isDone())
      readCommandPromise.resolve('changed');

    const command = await readCommandPromise;

    if (command === 'changed') {
      const dirtyTestFiles = fsWatcher.takeDirtyTestFiles();
      console.log(dirtyTestFiles);
      // Resolve files that depend on the changed files.
      // await runChangedTests(config, failedTestIdCollector, dirtyTestFiles);
      continue;
    }

    if (command === 'run') {
      // All means reset filters.
      await runTests(config, teleReporter, failedTestIdCollector);
      continue;
    }

    if (command === 'failed') {
      config._internal.testIdMatcher = id => failedTestIdCollector.has(id);
      await runTests(config, teleReporter, failedTestIdCollector);
      config._internal.testIdMatcher = undefined;
      continue;
    }

    if (command === 'exit')
      break;

    if (command === 'interrupted') {
      result = 'interrupted';
      break;
    }
  }

  return result === 'passed' ? await globalCleanup() : result;
}

async function runTests(config: FullConfigInternal, teleReporter: TeleReporterEmitter, failedTestIdCollector: Set<string>) {
  const reporter = new Multiplexer([new ListReporter(), teleReporter]);
  const taskRunner = createTaskRunnerForWatch(config, reporter);
  const context: TaskRunnerState = {
    config,
    reporter,
    phases: [],
  };
  clearCompilationCache();
  reporter.onConfigure(config);
  const taskStatus = await taskRunner.run(context, 0);
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

type Command = 'run' | 'failed' | 'repeat' | 'changed' | 'project' | 'file' | 'grep' | 'exit' | 'interrupted' | 'toggle-show-browser';
