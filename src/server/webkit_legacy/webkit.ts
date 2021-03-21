/**
 * Copyright 2017 Google Inc. All rights reserved.
 * Modifications copyright (c) Microsoft Corporation.
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

import { RecentLogsCollector } from '../../utils/debugLogger';
import { TimeoutSettings } from '../../utils/timeoutSettings';
import { BrowserOptions, BrowserProcess, PlaywrightOptions } from '../browser';
import { BrowserType } from '../browserType';
import { helper } from '../helper';
import { CallMetadata } from '../instrumentation';
import { Env } from '../processLauncher';
import { ProgressController } from '../progress';
import { ConnectionTransport } from '../transport';
import * as types from '../types';
import { WKBrowser } from '../webkit/wkBrowser';
import { WKModernizerTransport } from './wkModernizerTransport';

export class WebKit extends BrowserType {
  constructor(playwrightOptions: PlaywrightOptions) {
    super('webkit', playwrightOptions);
  }

  _connectToTransport(transport: ConnectionTransport, options: BrowserOptions): Promise<WKBrowser> {
    throw new Error('Not implemented');
  }

  _amendEnvironment(env: Env, userDataDir: string, executable: string, browserArguments: string[]): Env {
    throw new Error('Not implemented');
  }

  _rewriteStartupError(error: Error): Error {
    return error;
  }

  _attemptToGracefullyCloseBrowser(transport: ConnectionTransport): void {
    throw new Error('Not implemented');
  }

  _defaultArgs(options: types.LaunchOptions, isPersistent: boolean, userDataDir: string): string[] {
    throw new Error('Not implemented');
  }

  async connectOverCDP(metadata: CallMetadata, wsEndpoint: string, options: { slowMo?: number, sdkLanguage: string }, timeout?: number) {
    const controller = new ProgressController(metadata, this);
    controller.setLogName('browser');
    const browserLogsCollector = new RecentLogsCollector();
    return controller.run(async progress => {
      const webkitTransport = await WKModernizerTransport.connect(wsEndpoint);
      const browserProcess: BrowserProcess = {
        close: async () => {
          await webkitTransport.closeAndWait();
        },
        kill: async () => {
          await webkitTransport.closeAndWait();
        }
      };
      const browserOptions: BrowserOptions = {
        ...this._playwrightOptions,
        slowMo: options.slowMo,
        name: 'webkit',
        isChromium: false,
        persistent: { sdkLanguage: options.sdkLanguage, noDefaultViewport: true },
        browserProcess,
        protocolLogger: helper.debugProtocolLogger(),
        browserLogsCollector,
      };
      return await WKBrowser.connect(webkitTransport, browserOptions);
    }, TimeoutSettings.timeout({timeout}));
  }
}
