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

import { Transport } from './transport';
import { DispatcherConnection } from './server/dispatcher';
import { Playwright } from '../server/playwright';
import { BrowserTypeDispatcher } from './server/browserTypeDispatcher';

const connection = new DispatcherConnection();
const rootScope = connection.createScope('');
const transport = new Transport(process.stdout, process.stdin);
transport.onmessage = message => connection.dispatch(message);
connection.onmessage = message => transport.send(message);

const playwright = new Playwright(__dirname, require('../../browsers.json')['browsers']);
new BrowserTypeDispatcher(rootScope, playwright.chromium!);
new BrowserTypeDispatcher(rootScope, playwright.firefox!);
new BrowserTypeDispatcher(rootScope, playwright.webkit!);
