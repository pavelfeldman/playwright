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

import type { Page } from './page';

import * as fakeTimersSource from '../generated/fakeTimersSource';
import type { InjectedScriptExtension } from './browserContext';

export class Clock {
  private _page: Page;
  private _extension: InjectedScriptExtension | undefined;

  constructor(page: Page) {
    this._page = page;
  }

  private async _initialize() {
    if (!this._extension)
      this._extension = await this._page.context().extendInjectedScript(fakeTimersSource.source);
    return this._extension;
  }

  async install(now: number | undefined) {
    const extension = await this._initialize();
    console.log('INSTALL 1', now);
    for (const handle of extension.handles) {
      console.log('INSTALL 2', now);
      handle.evaluate((clock, now) => {
        console.log('INSTALL 3', now);
        clock.install(now);
      }, now);
    }
  }

  async setTime(now: number) {
    const extension = await this._initialize();
    for (const handle of extension.handles) {
      handle.evaluate((clock, now) => {
        clock.setTime(now);
      }, now);
    }
  }

  async tick(time: number) {
    const extension = await this._initialize();
    for (const handle of extension.handles) {
      handle.evaluate((clock, time) => {
        clock.tick(time);
      }, time);
    }
  }

  async uninstall() {
    const extension = await this._initialize();
    for (const handle of extension.handles) {
      handle.evaluate(clock => {
        clock.uninstall();
      });
    }
  }
}
