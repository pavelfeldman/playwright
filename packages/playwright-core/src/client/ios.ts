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

import { ChannelOwner } from './channelOwner';

import type * as channels from '@protocol/channels';
import type * as api from '../../types/types';

export class IOS extends ChannelOwner<channels.IOSChannel> implements api.IOS {

  static from(ios: channels.IOSChannel): IOS {
    return (ios as any)._object;
  }

  constructor(parent: ChannelOwner, type: string, guid: string, initializer: channels.IOSInitializer) {
    super(parent, type, guid, initializer);
  }

  async devices(): Promise<IOSDevice[]> {
    const { devices } = await this._channel.devices();
    return devices.map(d => IOSDevice.from(d));
  }
}

export class IOSDevice extends ChannelOwner<channels.IOSDeviceChannel> implements api.IOSDevice {
  static from(iosDevice: channels.IOSDeviceChannel): IOSDevice {
    return (iosDevice as any)._object;
  }

  constructor(parent: ChannelOwner, type: string, guid: string, initializer: channels.IOSDeviceInitializer) {
    super(parent, type, guid, initializer);
  }

  async launch(app: string) {
    await this._channel.launch({ app });
  }

  async pressButton(button: 'home' | 'lock') {
    await this._channel.pressButton({ button });
  }

  async inputText(text: string) {
    await this._channel.inputText({ text });
  }

  async screenshot(options: { path?: string } = {}): Promise<Buffer> {
    const { binary } = await this._channel.screenshot();
    if (options.path)
      await this._platform.fs().promises.writeFile(options.path, binary);
    return binary;
  }
}
