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

import { chromium } from 'playwright-core';
import debug from 'debug';

const recordDebug = debug('rec');
recordDebug.color = '160';

import type { BrowserContext } from '../../playwright-core/src/client/browserContext';
import type * as actions from '@recorder/actions';
import type * as playwright from 'playwright-core';

export async function runRecorderLoop() {
  const browser = await chromium.launch({ headless: false, handleSIGINT: false, handleSIGTERM: false });
  const context = await browser.newContext() as BrowserContext;
  new Tracker().init(context);
  const page = await context.newPage();
  await page.goto('https://playwright.dev/');
}

class Tracker {
  private _scheduleTimeout: NodeJS.Timeout | undefined;

  constructor() {
  }

  async init(context: BrowserContext) {
    context.on('page', () => this._onPage);
    await context._enableRecorder({
      mode: 'recording',
      recorderMode: 'api',
    }, {
      actionAdded: (page: playwright.Page, actionInContext: actions.ActionInContext) => {
        const action = actionInContext.action;
        this._actionAdded(page, action);
      },
      actionUpdated: (page: playwright.Page, actionInContext: actions.ActionInContext) => {
        const action = actionInContext.action;
        this._actionUpdated(page, action);
      },
      signalAdded: (page: playwright.Page, signalInContext: actions.SignalInContext) => {
        const signal = signalInContext.signal;
        this._signalAdded(page, signal);
      },
    });
  }

  private _onPage(page: playwright.Page) {
    page.on('request', () => this._clearNetworkIdle(page));
    page.on('requestfinished', () => this._scheduleNetworkIdle(page));
    page.on('load', () => recordDebug('load', page));
  }

  private _actionAdded(page: playwright.Page, action: actions.Action) {
    recordDebug('actionAdded', action.name);
    this._scheduleNetworkIdle(page);
  }

  private  _actionUpdated(page: playwright.Page, action: actions.Action) {
    recordDebug('actionUpdated', action.name);
    this._scheduleNetworkIdle(page);
  }

  private _signalAdded(page: playwright.Page, signal: actions.Signal) {
    recordDebug('signalAdded', signal.name);
    this._scheduleNetworkIdle(page);
  }

  private _clearNetworkIdle(page: playwright.Page) {
    clearTimeout(this._scheduleTimeout);
  }

  private _scheduleNetworkIdle(page: playwright.Page) {
    clearTimeout(this._scheduleTimeout);
    this._scheduleTimeout = setTimeout(() => {
      recordDebug('networkidle');
    }, 1000);
  }
}
