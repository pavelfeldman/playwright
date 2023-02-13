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
import type { Page } from 'playwright-core/lib/server/page';
import { showTraceViewer } from 'playwright-core/lib/server/trace/viewer/traceViewer';
import { clearCompilationCache } from '../common/compilationCache';
import type { FullConfigInternal } from '../common/types';
import ListReporter from '../reporters/list';
import { Multiplexer } from '../reporters/multiplexer';
import { TeleReporterEmitter } from '../reporters/teleEmitter';
import { createTaskRunnerForList, createTaskRunnerForWatch, createTaskRunnerForWatchSetup } from './tasks';
import type { TaskRunnerState } from './tasks';
import { createReporter } from './reporters';
import { EmptyRecorderApp } from 'playwright-core/lib/server/recorder/recorderApp';
import { Source } from '@recorder/recorderTypes';
import { Recorder } from 'playwright-core/lib/server/recorder';
import { asLocator } from 'playwright-core/lib/server/isomorphic/locatorGenerators';

export async function runUIMode(config: FullConfigInternal): Promise<FullResult['status']> {
  // Reset the settings that don't apply to watch.
  config._internal.passWithNoTests = true;
  for (const p of config.projects)
    p.retries = 0;

  {
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
  }

  // Show trace viewer.
  const { page } = await showTraceViewer([], 'chromium', { watchMode: true });
  await page.mainFrame().evaluateExpression('window.noRecorder = true', false, undefined, 'main');
  Recorder.setAppFactory(async () => new InspectingRecorderApp(page));
  const recorder = await Recorder.show(page.context(), { omitCallTracking: true });

  {
    // List
    const controller = new Controller(config, page, recorder);
    const listReporter = new TeleReporterEmitter(message => controller!.send(message));
    const reporter = new Multiplexer([listReporter]);
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

  await new Promise(() => {});
  // await globalCleanup();
  return 'passed';
}


class Controller {
  private _page: Page;
  private _queue = Promise.resolve();
  private _runReporter: TeleReporterEmitter;

  constructor(config: FullConfigInternal, page: Page, recorder: Recorder) {
    this._page = page;
    this._runReporter = new TeleReporterEmitter(message => this!.send(message));
    this._page.exposeBinding('binding', false, (source, data) => {
      const { method, params } = data;
      if (method === 'run') {
        const { location } = params;
        config._internal.cliArgs = [location];
        this._queue = this._queue.then(() => runTests(config, this._runReporter));
        return this._queue;
      }
      if (method === 'setMode') {
        // console.log('SET MODE', params);
        recorder.setMode(params.mode);
      }
      if (method === 'setLocator') {
        // console.log('SET LOCATOR', params);
        recorder.setMode('none');
      }
    });
  }

  send(message: any) {
    const func = (message: any) => {
      (window as any).dispatch(message);
    };
    // eslint-disable-next-line no-console
    this._page.mainFrame().evaluateExpression(String(func), true, message).catch(e => console.log(e));
  }
}

async function runTests(config: FullConfigInternal, teleReporter: TeleReporterEmitter) {
  const reporter = new Multiplexer([new ListReporter(), teleReporter]);
  config._internal.configCLIOverrides.use = config._internal.configCLIOverrides.use || {};
  config._internal.configCLIOverrides.use.trace = 'on';

  const taskRunner = createTaskRunnerForWatch(config, reporter);
  const context: TaskRunnerState = {
    config,
    reporter,
    phases: [],
  };
  clearCompilationCache();
  reporter.onConfigure(config);
  const status = await taskRunner.run(context, 0);
  await reporter.onExit({ status });
}

class InspectingRecorderApp extends EmptyRecorderApp {
  private _page: Page;

  constructor(page: Page) {
    super();
    this._page = page;
  }

  override async setSelector(selector: string): Promise<void> {
    // console.log('SET LOCATOR', selector);
    const recorder = await Recorder.show(this._page.context());
    recorder.setMode('none');

    const locator = asLocator('javascript', selector);
    const func = (message: any) => {
      (window as any).dispatch(message);
    };
    // eslint-disable-next-line no-console
    this._page.mainFrame().evaluateExpression(String(func), true, { method: 'setLocator', params: { locator }}).catch(e => console.log(e));
  }

  override async setSources(sources: Source[]): Promise<void> {
  }

  override async setPaused(paused: boolean) {
  }
}
