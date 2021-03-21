/**
 * Copyright 2017 Google Inc. All rights reserved.
 * Modifications copyright (c) Microsoft Corporation.
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

import { Browser, BrowserOptions } from '../browser';
import { assertBrowserContextIsNotOwned, BrowserContext, validateBrowserContextOptions, verifyGeolocation } from '../browserContext';
import { helper, RegisteredListener } from '../helper';
import { assert } from '../../utils/utils';
import * as network from '../network';
import { Page, PageBinding, PageDelegate } from '../page';
import { ConnectionTransport } from '../transport';
import * as types from '../types';
import { Protocol } from './protocol';
import { kPageProxyMessageReceived, PageProxyMessageReceivedPayload, WKConnection, WKSession } from './wkConnection';
import { WKPage } from './wkPage';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.2 Safari/605.1.15';
const BROWSER_VERSION = '14.2';

export class WKBrowser extends Browser {
  private readonly _connection: WKConnection;
  readonly _browserSession: WKSession;
  readonly _contexts = new Map<string, WKBrowserContext>();
  readonly _wkPages = new Map<string, WKPage>();
  private readonly _eventListeners: RegisteredListener[];

  static async connect(transport: ConnectionTransport, options: BrowserOptions): Promise<WKBrowser> {
    const browser = new WKBrowser(transport, options);
    if ((options as any).__testHookOnConnectToBrowser)
      await (options as any).__testHookOnConnectToBrowser();
    const promises: Promise<any>[] = [
      browser._browserSession.send('Playwright.enable'),
    ];
    if (options.persistent) {
      browser._defaultContext = new WKBrowserContext(browser, undefined, options.persistent);
      promises.push((browser._defaultContext as WKBrowserContext)._initialize());
    }
    await Promise.all(promises);
    return browser;
  }

  constructor(transport: ConnectionTransport, options: BrowserOptions) {
    super(options);
    this._connection = new WKConnection(transport, this._onDisconnect.bind(this), options.protocolLogger, options.browserLogsCollector);
    this._browserSession = this._connection.browserSession;
    this._eventListeners = [
      helper.addEventListener(this._browserSession, 'Playwright.pageProxyCreated', this._onPageProxyCreated.bind(this)),
      helper.addEventListener(this._browserSession, 'Playwright.pageProxyDestroyed', this._onPageProxyDestroyed.bind(this)),
      helper.addEventListener(this._browserSession, kPageProxyMessageReceived, this._onPageProxyMessageReceived.bind(this)),
    ];
  }

  _onDisconnect() {
    for (const wkPage of this._wkPages.values())
      wkPage.dispose(true);
    this._didClose();
  }

  contexts(): BrowserContext[] {
    return Array.from(this._contexts.values());
  }

  version(): string {
    return BROWSER_VERSION;
  }

  _onPageProxyCreated(event: Protocol.Playwright.pageProxyCreatedPayload) {
    const pageProxyId = event.pageProxyId;
    let context: WKBrowserContext | null = null;
    if (event.browserContextId) {
      // FIXME: we don't know about the default context id, so assume that all targets from
      // unknown contexts are created in the 'default' context which can in practice be represented
      // by multiple actual contexts in WebKit. Solving this properly will require adding context
      // lifecycle events.
      context = this._contexts.get(event.browserContextId) || null;
    }
    if (!context)
      context = this._defaultContext as WKBrowserContext;
    if (!context)
      return;
    const pageProxySession = new WKSession(this._connection, pageProxyId, `The page has been closed.`, (message: any) => {
      this._connection.rawSend({ ...message, pageProxyId });
    });
    const opener = event.openerId ? this._wkPages.get(event.openerId) : undefined;
    const wkPage = new WKPage(context, pageProxySession, opener || null);
    this._wkPages.set(pageProxyId, wkPage);
    wkPage._page.reportAsNew();
  }

  _onPageProxyDestroyed(event: Protocol.Playwright.pageProxyDestroyedPayload) {
    const pageProxyId = event.pageProxyId;
    const wkPage = this._wkPages.get(pageProxyId);
    if (!wkPage)
      return;
    wkPage.didClose();
    wkPage.dispose(false);
    this._wkPages.delete(pageProxyId);
  }

  _onPageProxyMessageReceived(event: PageProxyMessageReceivedPayload) {
    const wkPage = this._wkPages.get(event.pageProxyId);
    if (!wkPage)
      return;
    wkPage.dispatchMessageToSession(event.message);
  }

  isConnected(): boolean {
    return !this._connection.isClosed();
  }
}

export class WKBrowserContext extends BrowserContext {
  readonly _browser: WKBrowser;
  readonly _browserContextId: string | undefined;
  readonly _evaluateOnNewDocumentSources: string[];

  constructor(browser: WKBrowser, browserContextId: string | undefined, options: types.BrowserContextOptions) {
    super(browser, options, browserContextId);
    this._browser = browser;
    this._evaluateOnNewDocumentSources = [];
    this._authenticateProxyViaHeader();
  }

  async _initialize() {
  }

  _wkPages(): WKPage[] {
    return Array.from(this._browser._wkPages.values()).filter(wkPage => wkPage._browserContext === this);
  }

  pages(): Page[] {
    return this._wkPages().map(wkPage => wkPage._initializedPage).filter(pageOrNull => !!pageOrNull) as Page[];
  }

  async newPageDelegate(): Promise<PageDelegate> {
    assertBrowserContextIsNotOwned(this);
    const { pageProxyId } = await this._browser._browserSession.send('Playwright.createPage', { browserContextId: this._browserContextId });
    return this._browser._wkPages.get(pageProxyId)!;
  }

  async _doAddInitScript(source: string) {
    this._evaluateOnNewDocumentSources.push(source);
    for (const page of this.pages())
      await (page._delegate as WKPage)._updateBootstrapScript();
  }

  async _doExposeBinding(binding: PageBinding) {
    for (const page of this.pages())
      await (page._delegate as WKPage).exposeBinding(binding);
  }

  async _doUpdateRequestInterception(): Promise<void> {
    for (const page of this.pages())
      await (page._delegate as WKPage).updateRequestInterception();
  }

  newContext(options: types.BrowserContextOptions): Promise<BrowserContext> {
    throw new Error('Not implemented');
  }
  _doClose(): Promise<void> {
    throw new Error('Not implemented');
  }
  _doGrantPermissions(origin: string, permissions: string[]): Promise<void> {
    throw new Error('Not implemented');
  }
  _doClearPermissions(): Promise<void> {
    throw new Error('Not implemented');
  }
  setGeolocation(geolocation?: types.Geolocation): Promise<void> {
    throw new Error('Not implemented');
  }
  _doSetHTTPCredentials(httpCredentials?: types.Credentials): Promise<void> {
    throw new Error('Not implemented');
  }
  setExtraHTTPHeaders(headers: types.HeadersArray): Promise<void> {
    throw new Error('Not implemented');
  }
  setOffline(offline: boolean): Promise<void> {
    throw new Error('Not implemented');
  }
  async _doCookies(urls: string[]): Promise<types.NetworkCookie[]> {
    throw new Error('Not implemented');
  }
  async addCookies(cookies: types.SetNetworkCookieParam[]) {
    throw new Error('Not implemented');
  }
  async clearCookies() {
    throw new Error('Not implemented');
  }
}
