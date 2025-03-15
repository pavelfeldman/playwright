/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License");
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

import { Dispatcher, existingDispatcher } from './dispatcher';

import type { RootDispatcher } from './dispatcher';
import type { IOS } from '../ios/ios';
import type * as channels from '@protocol/channels';
import type { IOSDevice } from '../ios/iosDevice';

export class IOSDispatcher extends Dispatcher<IOS, channels.IOSChannel, RootDispatcher> implements channels.IOSChannel {
  _type_IOS = true;
  constructor(scope: RootDispatcher, android: IOS) {
    super(scope, android, 'IOS', {});
  }

  async devices(params: channels.IOSDevicesParams): Promise<channels.IOSDevicesResult> {
    const devices = await this._object.devices();
    return {
      devices: devices.map(d => IOSDeviceDispatcher.from(this, d))
    };
  }
}

export class IOSDeviceDispatcher extends Dispatcher<IOSDevice, channels.IOSDeviceChannel, IOSDispatcher> implements channels.IOSDeviceChannel {
  _type_EventTarget = true;
  _type_IOSDevice = true;

  static from(scope: IOSDispatcher, device: IOSDevice): IOSDeviceDispatcher {
    const result = existingDispatcher<IOSDeviceDispatcher>(device);
    return result || new IOSDeviceDispatcher(scope, device);
  }

  constructor(scope: IOSDispatcher, device: IOSDevice) {
    super(scope, device, 'IOSDevice', {
      serial: device.serial,
      name: device.name,
    });
  }

  async screenshot(params: channels.IOSDeviceScreenshotParams): Promise<channels.IOSDeviceScreenshotResult> {
    return { binary: await this._object.screenshot() };
  }

  async launch(params: channels.IOSDeviceLaunchParams): Promise<channels.IOSDeviceLaunchResult> {
    await this._object.launch(params.app);
  }

  async pressButton(params: channels.IOSDevicePressButtonParams): Promise<channels.IOSDevicePressButtonResult> {
    await this._object.pressButton(params);
  }

  async inputText(params: channels.IOSDeviceInputTextParams): Promise<channels.IOSDeviceInputTextResult> {
    await this._object.inputText(params);
  }
}
