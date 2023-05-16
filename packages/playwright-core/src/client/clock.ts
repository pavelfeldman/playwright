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

import type * as api from '../../types/types';
import type * as channels from '@protocol/channels';

export class Clock implements api.Clock {
  private _channel: channels.PageChannel;

  constructor(channel: channels.PageChannel) {
    this._channel = channel;
  }

  async install(options: { now?: number } = {}) {
    await this._channel.clockInstall(options);
  }

  async tick(time: number) {
    await this._channel.clockTick({ time });
  }

  async setTime(now: number) {
    await this._channel.clockSetTime({ now });
  }

  async uninstall() {
    await this._channel.clockUninstall();
  }
}
