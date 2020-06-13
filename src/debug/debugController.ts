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

import { BrowserContextBase } from '../browserContext';
import * as frames from '../frames';
import { Events } from '../events';
import { helper } from '../helper';
import { Page } from '../page';
import { RecorderController } from './recorderController';

export class DebugController {
  private _context: BrowserContextBase;

  constructor(context: BrowserContextBase) {
    this._context = context;
    if (!helper.isDebugMode())
      return;

    const installInFrame = async (frame: frames.Frame) => {
      try {
        const mainContext = await frame._mainContext();
        await mainContext.debugScript();
      } catch (e) {
      }
    };

    context.on(Events.BrowserContext.Page, (page: Page) => {
      for (const frame of page.frames())
        installInFrame(frame);
      page.on(Events.Page.FrameNavigated, installInFrame);
      new RecorderController(page);
    });
  }
}
