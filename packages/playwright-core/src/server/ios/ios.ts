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

import type * as channels from '@protocol/channels';

const execAsync = util.promisify(exec);

export class IOS extends SdkObject {

  constructor(parent: SdkObject) {
    super(parent, 'ios');
  }

  async devices(options: channels.IOSDevicesOptions): Promise<IOSDevice[]> {
    try {
      debug('pw:ios:devices')('Listing iOS simulator devices');
      const { stdout } = await execAsync('xcrun simctl list devices');
      // iPhone 16 Pro (24F102D5-CA71-4D01-A7D5-3A005D8DDBBD) (Booted) 
      // iPhone 16 Pro Max (AE9C1037-661E-4A86-974A-D74D9D0F76DF) (Shutdown)
      const devices: IOSDevice[] = [];
      const lines = stdout.split('\n');
      
      const deviceRegex = /(.+) \(([0-9A-F-]+)\) \((.+)\)/;
      for (const line of lines) {
        const match = line.trim().match(deviceRegex);
        if (match) {
          const [, name, serial, status] = match;
          debug('pw:ios:devices')(`Found device: ${name} (${serial}) (${status})`);
          if (status === 'Booted')
            devices.push(new IOSDevice(this, serial, name));
        }
      }
      
      return devices;
    } catch (error) {
      debug('pw:ios:devices')(`Error listing iOS devices: ${error}`);
      return [];
    }
  }
}

type DeviceInfoResponse = {
  widthPixels: number;
  widthPoints: number;
  heightPoints: number;
  heightPixels: number;
};

type StatusResponse = {
  status: string;
};

type ViewHierarchyRequest = {
  appIds: string[];
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
  appIds: string[];
};

type SwipeRequest = {
  appId?: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  duration: number;
  appIds?: string[];
};

type RunningAppRequest = {
  appIds: string[];
};

type IsScreenStaticResponse = {
  isScreenStatic: boolean;
};

export class IOSDevice extends SdkObject {
  readonly name: string;
  readonly serial: string;
  readonly _ios: IOS;
  private _driverPromise: ManualPromise<number> | undefined;

  constructor(ios: IOS, serial: string, name: string) {
    super(ios, 'ios-device');
    this._ios = ios;
    this.serial = serial;
    this.name = name;
  }

  async deviceInfo(): Promise<DeviceInfoResponse> {
    return await this._fetchJson<DeviceInfoResponse>('deviceInfo');
  }

  async status(): Promise<StatusResponse> {
    return await this._fetchJson<StatusResponse>('status');
  }

  async launch(app: string) {
    await execAsync('xcrun simctl launch ' + this.serial + ' ' + app);
  }

  async screenshot(compressed?: boolean) {
    await this._waitForAnimationsToComplete();
    const result = await this._fetch('screenshot', { compressed: compressed ? 'true' : 'false' });
    const image = await result.arrayBuffer();
    return Buffer.from(image);
  }

  async viewHierarchy(request: ViewHierarchyRequest): Promise<ViewHierarchyResponse> {
    return await this._fetchJson<ViewHierarchyResponse>('viewHierarchy', {}, request);
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
    return await this._fetch('inputText', {}, request);
  }

  async swipe(request: SwipeRequest) {
    return await this._fetch('swipe', {}, request);
  }

  async runningApp(request: RunningAppRequest) {
    return await this._fetch('runningApp', {}, request);
  }

  async isScreenStatic(): Promise<IsScreenStaticResponse> {
    return await this._fetchJson<IsScreenStaticResponse>('isScreenStatic');
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

  private async _fetchJson<T>(path: string, queryParams: Record<string, any> = {}, body: any = undefined) {
    const response = await this._fetch(path, queryParams, body);
    return response.json() as T;
  }

  private async _fetch(path: string, queryParams: Record<string, any> = {}, body: any = undefined) {
    const port = await this._driverPort();
    const url = new URL(path, `http://localhost:${port}`);
    for (const [key, value] of Object.entries(queryParams))
      url.searchParams.append(key, String(value));
    return await fetch(url, {
      method: body ? 'POST' : 'GET',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async _driverPort() {
    if (this._driverPromise)
      return this._driverPromise;

    this._driverPromise = new ManualPromise();

    const childProcess = spawn(`xcodebuild`, [
      'test-without-building',
      '-xctestrun',
      path.join(__dirname, 'maestro-driver-ios-config.xctestrun'),
      '-destination',
      `"platform=iOS Simulator,id=${this.serial}"`,
      '-destination-timeout', '1'], { shell: true, stdio: 'pipe' });

    childProcess.stdout.on('data', data => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        //  [FlyingFox] starting server ::1:22087
        const serverMatch = line.match(/\[FlyingFox\] starting server .*:([0-9]+)/);
        if (serverMatch) {
          this._driverPromise!.resolve(+serverMatch[1]);
          return;
        }
      }
    });
    childProcess.stderr.on('data', () => {});
    return this._driverPromise;
  }
}
