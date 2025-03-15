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

import { exec } from 'child_process';
import * as util from 'util';
import { spawn } from 'child_process';
import * as path from 'path';

import { debug } from '../../utilsBundle';
import { SdkObject } from '../instrumentation';
import { ManualPromise } from '../../utils/isomorphic/manualPromise';
import { DriverTransport } from './transport';

import type { IOS } from './ios';

const execAsync = util.promisify(exec);

type DeviceInfoResponse = {
  widthPixels: number;
  widthPoints: number;
  heightPoints: number;
  heightPixels: number;
};

type StatusResponse = {
  status: string;
};

type ScreenshotResponse = {
  screenshot: string;
};

type ViewHierarchyRequest = {
  appIds?: string[];
  excludeKeyboardElements: boolean;
};

type AXFrame = {
  Width: number;
  X: number;
  Y: number;
  Height: number;
};

type AXElement = {
  identifier: string;
  frame: AXFrame;
  value?: string;
  title?: string;
  label: string;
  elementType: number;
  enabled: boolean;
  horizontalSizeClass: number;
  verticalSizeClass: number;
  placeholderValue?: string;
  selected: boolean;
  hasFocus: boolean;
  children?: AXElement[];
  windowContextID: number;
  displayID: number;
};

type TouchRequest = {
  x: number;
  y: number;
  duration?: number;
};

type PressKeyRequest = {
  key: string;
};

type ViewHierarchyResponse = {
  axElement: AXElement;
  depth: number;
};

type PressButtonRequest = {
  button: 'home' | 'lock';
};

type InputTextRequest = {
  text: string;
  appIds?: string[];
};

type EraseTextRequest = {
  appIds?: string[];
};

type SwipeRequest = {
  appId?: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  duration: number;
  appIds?: string[];
};

type RunningAppRequest = {
  appIds?: string[];
};

type IsScreenStaticResponse = {
  isScreenStatic: boolean;
};

export class IOSDevice extends SdkObject {
  readonly name: string;
  readonly serial: string;
  readonly _ios: IOS;
  private _driverPromise: ManualPromise<DriverTransport> | undefined;

  constructor(ios: IOS, serial: string, name: string) {
    super(ios, 'ios-device');
    this._ios = ios;
    this.serial = serial;
    this.name = name;
  }

  async launch(app: string) {
    debug('pw:ios:device')(`Launching ${app} on ${this.serial}`);
    await execAsync('xcrun simctl launch ' + this.serial + ' ' + app);
  }

  async screenshot(compressed?: boolean) {
    await this._waitForAnimationsToComplete();
    const result = await this._fetch<ScreenshotResponse>('screenshot', { compressed: compressed ? 'true' : 'false' });
    return Buffer.from(result.screenshot, 'base64');
  }

  async status() {
    return await this._fetch<StatusResponse>('status');
  }

  async deviceInfo() {
    return await this._fetch<DeviceInfoResponse>('deviceInfo');
  }

  async eraseText() {
    return await this._fetch<EraseTextRequest>('eraseText');
  }

  async viewHierarchy(request: ViewHierarchyRequest): Promise<ViewHierarchyResponse> {
    return await this._fetch<ViewHierarchyResponse>('viewHierarchy', {}, request);
  }

  async touch(request: TouchRequest) {
    return await this._fetch('touch', {}, request);
  }

  async pressKey(request: PressKeyRequest) {
    return await this._fetch('pressKey', {}, request);
  }

  async pressButton(request: PressButtonRequest) {
    return await this._fetch('pressButton', {}, request);
  }

  async inputText(request: InputTextRequest) {
    return await this._fetch('inputText', {}, { appIds: [], ...request });
  }

  async swipe(request: SwipeRequest) {
    return await this._fetch('swipe', {}, request);
  }

  async runningApp(request: RunningAppRequest) {
    return await this._fetch('runningApp', {}, request);
  }

  async isScreenStatic(): Promise<IsScreenStaticResponse> {
    return await this._fetch<IsScreenStaticResponse>('isScreenStatic');
  }

  private async _waitForAnimationsToComplete(options: { timeout?: number, pollInterval?: number } = {}): Promise<void> {
    const timeout = options.timeout || 5000;
    const pollInterval = options.pollInterval || 100;

    const startTime = performance.now();
    while (performance.now() - startTime < timeout) {
      const { isScreenStatic } = await this.isScreenStatic();
      if (isScreenStatic)
        return;
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timed out waiting for animations to complete after ${timeout}ms`);
  }

  private async _fetch<T>(path: string, queryParams: Record<string, any> = {}, body: any = undefined) {
    const driver = await this._driver();
    const result = await driver.fetch(path, queryParams, body);
    return result as T;
  }

  async _driver() {
    if (this._driverPromise)
      return this._driverPromise;

    this._driverPromise = new ManualPromise();

    const args = [
      'test-without-building',
      '-xctestrun',
      path.join(__dirname, 'driver/ios-driver_iphonesimulator18.2-arm64-x86_64.xctestrun'),
      '-destination',
      `"id=${this.serial}"`,
      '-destination-timeout', '1'
    ];

    const childProcess = spawn(`xcodebuild`, args, { shell: true, stdio: 'pipe' });
    childProcess.stdout.on('data', data => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        //  [FlyingFox] starting server ::1:22087
        const serverMatch = line.match(/\[FlyingFox\] starting server .*:([0-9]+)/);
        if (serverMatch) {
          const pageTransport = new DriverTransport();
          pageTransport.connect().then(() => this._driverPromise!.resolve(pageTransport));
          return;
        }
      }
    });
    childProcess.stderr.on('data', () => {});
    return this._driverPromise;
  }
}
