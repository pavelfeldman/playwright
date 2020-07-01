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

import * as util from 'util';
import { ConsoleMessageLocation } from '../../types';
import { JSHandle } from './jsHandle';
import { ConsoleMessageChannel, ConsoleMessageInitializer } from '../channels';
import { Connection, ChannelGuid } from './connection';
import { ChannelOwner } from './channelOwner';

export class ConsoleMessage extends ChannelOwner<ConsoleMessageChannel, ConsoleMessageInitializer> {
  static from(request: ConsoleMessageChannel): ConsoleMessage {
    return request._object;
  }

  constructor(connection: Connection, guid: ChannelGuid, initializer: ConsoleMessageInitializer) {
    super(connection, guid, initializer);
  }

  type(): string {
    return this._initializer.type;
  }

  text(): string {
    return this._initializer.text;
  }

  args(): JSHandle[] {
    return this._initializer.args.map(JSHandle.from);
  }

  location(): ConsoleMessageLocation {
    return this._initializer.location;
  }

  [util.inspect.custom]() {
    return this.text();
  }
}
