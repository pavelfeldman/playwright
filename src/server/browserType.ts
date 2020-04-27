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

import { BrowserContext } from '../browserContext';
import { BrowserServer } from './browserServer';
import * as browserPaths from '../installer/browserPaths';
import { Logger } from '../logger';

export type BrowserArgOptions = {
  headless?: boolean,
  args?: string[],
  devtools?: boolean,
};

type LaunchOptionsBase = BrowserArgOptions & {
  executablePath?: string,
  ignoreDefaultArgs?: boolean | string[],
  handleSIGINT?: boolean,
  handleSIGTERM?: boolean,
  handleSIGHUP?: boolean,
  timeout?: number,
  logger?: Logger,
  env?: {[key: string]: string|number|boolean}
};

export type ConnectOptions = {
  wsEndpoint: string,
  slowMo?: number,
  logger?: Logger,
};
export type LaunchOptions = LaunchOptionsBase & { slowMo?: number };
export type LaunchServerOptions = LaunchOptionsBase & { port?: number };
export interface BrowserType<Browser> {
  executablePath(): string;
  name(): string;
  launch(options?: LaunchOptions): Promise<Browser>;
  launchServer(options?: LaunchServerOptions): Promise<BrowserServer>;
  launchPersistentContext(userDataDir: string, options?: LaunchOptions): Promise<BrowserContext>;
  connect(options: ConnectOptions): Promise<Browser>;
}

export abstract class AbstractBrowserType<Browser> implements BrowserType<Browser> {
  private _name: string;
  private _executablePath: string;

  constructor(name: string, revision: string) {
    this._name = name;
    this._executablePath = browserPaths.executablePath({
      name,
      revision,
      platform: browserPaths.hostPlatform
    });
  }

  executablePath(): string {
    return this._executablePath;
  }

  name(): string {
    return this._name;
  }

  abstract launch(options?: LaunchOptions): Promise<Browser>;
  abstract launchServer(options?: LaunchServerOptions): Promise<BrowserServer>;
  abstract launchPersistentContext(userDataDir: string, options?: LaunchOptions): Promise<BrowserContext>;
  abstract connect(options: ConnectOptions): Promise<Browser>;
}
