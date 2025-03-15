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

import { debug } from '../../utilsBundle';
import { SdkObject } from '../instrumentation';
import { IOSDevice } from './iosDevice';

const execAsync = util.promisify(exec);

export class IOS extends SdkObject {

  constructor(parent: SdkObject) {
    super(parent, 'ios');
  }

  async devices(): Promise<IOSDevice[]> {
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
