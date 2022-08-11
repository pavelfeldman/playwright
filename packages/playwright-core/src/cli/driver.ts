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

/* eslint-disable no-console */

import fs from 'fs';
import * as playwright from '../..';
import type { BrowserType } from '../client/browserType';
import type { LaunchServerOptions } from '../client/types';
import { createPlaywright, DispatcherConnection, Root, PlaywrightDispatcher } from '../server';
import type { Playwright } from '../server';
import { IpcTransport, PipeTransport } from '../protocol/transport';
import { PlaywrightServer } from '../remote/playwrightServer';
import { gracefullyCloseAll } from '../utils/processLauncher';
import { Recorder } from '../server/recorder';
import { EmptyRecorderApp } from '../server/recorder/recorderApp';
import type { BrowserContext } from '../server/browserContext';
import { serverSideCallMetadata } from '../server/instrumentation';
import type { Mode } from '../server/recorder/recorderTypes';

export function printApiJson() {
  // Note: this file is generated by build-playwright-driver.sh
  console.log(JSON.stringify(require('../../api.json')));
}

export function runDriver() {
  const dispatcherConnection = new DispatcherConnection();
  new Root(dispatcherConnection, async (rootScope, { sdkLanguage }) => {
    const playwright = createPlaywright(sdkLanguage);
    return new PlaywrightDispatcher(rootScope, playwright);
  });
  const transport = process.send ? new IpcTransport(process) : new PipeTransport(process.stdout, process.stdin);
  transport.onmessage = message => dispatcherConnection.dispatch(JSON.parse(message));
  dispatcherConnection.onmessage = message => transport.send(JSON.stringify(message));
  transport.onclose = () => {
    // Drop any messages during shutdown on the floor.
    dispatcherConnection.onmessage = () => {};
    selfDestruct();
  };
}

export async function runServer(port: number | undefined, path = '/', maxClients = Infinity, enableSocksProxy = true, reuseBrowser = false) {
  const maxIncomingConnections = maxClients;
  const maxConcurrentConnections = reuseBrowser ? 1 : maxClients;
  const server = new PlaywrightServer(reuseBrowser ? 'reuse-browser' : 'auto', { path, maxIncomingConnections, maxConcurrentConnections, enableSocksProxy });
  const wsEndpoint = await server.listen(port);
  process.on('exit', () => server.close().catch(console.error));
  console.log('Listening on ' + wsEndpoint);  // eslint-disable-line no-console
  process.stdin.on('close', () => selfDestruct());
  if (process.send && server.preLaunchedPlaywright())
    wireController(server.preLaunchedPlaywright()!, wsEndpoint);
}

export async function launchBrowserServer(browserName: string, configFile?: string) {
  let options: LaunchServerOptions = {};
  if (configFile)
    options = JSON.parse(fs.readFileSync(configFile).toString());
  const browserType = (playwright as any)[browserName] as BrowserType;
  const server = await browserType.launchServer(options);
  console.log(server.wsEndpoint());
}

function selfDestruct() {
  // Force exit after 30 seconds.
  setTimeout(() => process.exit(0), 30000);
  // Meanwhile, try to gracefully close all browsers.
  gracefullyCloseAll().then(() => {
    process.exit(0);
  });
}

const internalMetadata = serverSideCallMetadata();

class ProtocolHandler {
  private _playwright: Playwright;
  private _autoCloseTimer: NodeJS.Timeout | undefined;

  constructor(playwright: Playwright) {
    this._playwright = playwright;
    playwright.instrumentation.addListener({
      onPageOpen: () => this._sendSnapshot(),
      onPageNavigated: () => this._sendSnapshot(),
      onPageClose: () => this._sendSnapshot(),
    }, null);
  }

  private _sendSnapshot() {
    const browsers = [];
    for (const browser of this._playwright.allBrowsers()) {
      const b = {
        name: browser.options.name,
        guid: browser.guid,
        contexts: [] as any[]
      };
      browsers.push(b);
      for (const context of browser.contexts()) {
        const c = {
          guid: context.guid,
          pages: [] as any[]
        };
        b.contexts.push(c);
        for (const page of context.pages()) {
          const p = {
            guid: page.guid,
            url: page.mainFrame().url()
          };
          c.pages.push(p);
        }
      }
    }
    process.send!({ method: 'browsersChanged', params: { browsers } });
  }

  async resetForReuse() {
    const contexts = new Set<BrowserContext>();
    for (const page of this._playwright.allPages())
      contexts.add(page.context());
    for (const context of contexts)
      await context.resetForReuse(internalMetadata, null);
  }

  async navigate(params: { url: string }) {
    for (const p of this._playwright.allPages())
      await p.mainFrame().goto(internalMetadata, params.url);
  }

  async setMode(params: { mode: Mode, language?: string, file?: string }) {
    await gc(this._playwright);

    if (params.mode === 'none') {
      for (const recorder of await allRecorders(this._playwright)) {
        recorder.setHighlightedSelector('');
        recorder.setMode('none');
      }
      this.setAutoClose({ enabled: true });
      return;
    }

    const browsers = this._playwright.allBrowsers();
    if (!browsers.length)
      await this._playwright.chromium.launch(internalMetadata, { headless: false });
    // Create page if none.
    const pages = this._playwright.allPages();
    if (!pages.length) {
      const [browser] = this._playwright.allBrowsers();
      const { context } = await browser.newContextForReuse({}, internalMetadata);
      await context.newPage(internalMetadata);
    }
    // Toggle the mode.
    for (const recorder of await allRecorders(this._playwright)) {
      recorder.setHighlightedSelector('');
      if (params.mode === 'recording')
        recorder.setOutput(params.language!, params.file);
      recorder.setMode(params.mode);
    }
    this.setAutoClose({ enabled: true });
  }

  async setAutoClose(params: { enabled: boolean }) {
    if (this._autoCloseTimer)
      clearTimeout(this._autoCloseTimer);
    if (!params.enabled)
      return;
    const heartBeat = () => {
      if (!this._playwright.allPages().length)
        selfDestruct();
      else
        this._autoCloseTimer = setTimeout(heartBeat, 5000);
    };
    this._autoCloseTimer = setTimeout(heartBeat, 30000);
  }

  async highlight(params: { selector: string }) {
    for (const recorder of await allRecorders(this._playwright))
      recorder.setHighlightedSelector(params.selector);
  }

  async hideHighlight() {
    await this._playwright.hideHighlight();
  }

  async kill() {
    selfDestruct();
  }
}

function wireController(playwright: Playwright, wsEndpoint: string) {
  process.send!({ method: 'ready', params: { wsEndpoint } });
  const handler = new ProtocolHandler(playwright);
  process.on('message', async message => {
    try {
      const result = await (handler as any)[message.method](message.params);
      process.send!({ id: message.id, result });
    } catch (e) {
      process.send!({ id: message.id, error: e.toString() });
    }
  });
}

async function gc(playwright: Playwright) {
  for (const browser of playwright.allBrowsers()) {
    for (const context of browser.contexts()) {
      if (!context.pages().length)
        await context.close(serverSideCallMetadata());
    }
    if (!browser.contexts())
      await browser.close();
  }
}

async function allRecorders(playwright: Playwright): Promise<Recorder[]> {
  const contexts = new Set<BrowserContext>();
  for (const page of playwright.allPages())
    contexts.add(page.context());
  const result = await Promise.all([...contexts].map(c => Recorder.show(c, { omitCallTracking: true }, () => Promise.resolve(new InspectingRecorderApp()))));
  return result.filter(Boolean) as Recorder[];
}

class InspectingRecorderApp extends EmptyRecorderApp {
  override async setSelector(selector: string): Promise<void> {
    process.send!({ method: 'inspectRequested', params: { selector } });
  }
}
