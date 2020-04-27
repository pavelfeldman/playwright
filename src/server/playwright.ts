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

import * as types from '../types';
import * as api from '../api';
import { helper } from '../helper';
import { TimeoutError } from '../errors';
import { DeviceDescriptors } from '../deviceDescriptors';
import { Chromium } from './chromium';
import { WebKit } from './webkit';
import { Firefox } from './firefox';
import { selectors } from '../selectors';

for (const className in api) {
  if (typeof (api as any)[className] === 'function')
    helper.installApiHooks(className[0].toLowerCase() + className.substring(1), (api as any)[className]);
}

type PlaywrightOptions = {
  browsers: Array<('firefox'|'webkit'|'chromium')>,
  packageJSON: any
};

export class Playwright {
  readonly selectors = selectors;
  readonly devices: types.Devices;
  readonly errors: { TimeoutError: typeof TimeoutError };
  readonly chromium: (Chromium|undefined);
  readonly firefox: (Firefox|undefined);
  readonly webkit: (WebKit|undefined);

  constructor(options: PlaywrightOptions) {
    const {
      browsers,
      packageJSON
    } = options;
    this.devices = DeviceDescriptors;
    this.errors = { TimeoutError };
    if (browsers.includes('chromium'))
      this.chromium = new Chromium(packageJSON['playwright']['chromium_revision']);
    if (browsers.includes('webkit'))
      this.webkit = new WebKit(packageJSON['playwright']['webkit_revision']);
    if (browsers.includes('firefox'))
      this.firefox = new Firefox(packageJSON['playwright']['firefox_revision']);
  }
}
