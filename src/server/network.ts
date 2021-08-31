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

import * as frames from './frames';
import * as types from './types';
import { assert } from '../utils/utils';
import { ManualPromise } from '../utils/async';
import { SdkObject } from './instrumentation';

export function filterCookies(cookies: types.NetworkCookie[], urls: string[]): types.NetworkCookie[] {
  const parsedURLs = urls.map(s => new URL(s));
  // Chromiums's cookies are missing sameSite when it is 'None'
  return cookies.filter(c => {
    // Firefox and WebKit can return cookies with empty values.
    if (!c.value)
      return false;
    if (!parsedURLs.length)
      return true;
    for (const parsedURL of parsedURLs) {
      let domain = c.domain;
      if (!domain.startsWith('.'))
        domain = '.' + domain;
      if (!('.' + parsedURL.hostname).endsWith(domain))
        continue;
      if (!parsedURL.pathname.startsWith(c.path))
        continue;
      if (parsedURL.protocol !== 'https:' && c.secure)
        continue;
      return true;
    }
    return false;
  });
}

export function rewriteCookies(cookies: types.SetNetworkCookieParam[]): types.SetNetworkCookieParam[] {
  return cookies.map(c => {
    assert(c.name, 'Cookie should have a name');
    assert(c.value, 'Cookie should have a value');
    assert(c.url || (c.domain && c.path), 'Cookie should have a url or a domain/path pair');
    assert(!(c.url && c.domain), 'Cookie should have either url or domain');
    assert(!(c.url && c.path), 'Cookie should have either url or domain');
    const copy = {...c};
    if (copy.url) {
      assert(copy.url !== 'about:blank', `Blank page can not have cookie "${c.name}"`);
      assert(!copy.url.startsWith('data:'), `Data URL page can not have cookie "${c.name}"`);
      const url = new URL(copy.url);
      copy.domain = url.hostname;
      copy.path = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
      copy.secure = url.protocol === 'https:';
    }
    return copy;
  });
}

export function parsedURL(url: string): URL | null {
  try {
    return new URL(url);
  } catch (e) {
    return null;
  }
}

export function stripFragmentFromUrl(url: string): string {
  if (!url.includes('#'))
    return url;
  return url.substring(0, url.indexOf('#'));
}

type RequestSizes = {
  responseBodySize: number;
  transferSize: number;
};

export class Request extends SdkObject {
  private _response: Response | null = null;
  private _redirectedFrom: Request | null;
  _redirectedTo: Request | null = null;
  readonly _documentId?: string;
  readonly _isFavicon: boolean;
  _failureText: string | null = null;
  private _url: string;
  private _resourceType: string;
  private _method: string;
  private _postData: Buffer | null;
  private _headers: types.HeadersArray;
  private _headersMap = new Map<string, string>();
  private _frame: frames.Frame;
  private _waitForResponsePromise = new ManualPromise<Response | null>();
  _responseEndTiming = -1;
  _sizes: RequestSizes = { responseBodySize: 0, transferSize: 0 };

  constructor(frame: frames.Frame, redirectedFrom: Request | null, documentId: string | undefined,
    url: string, resourceType: string, method: string, postData: Buffer | null, headers: types.HeadersArray) {
    super(frame, 'request');
    assert(!url.startsWith('data:'), 'Data urls should not fire requests');
    this._frame = frame;
    this._redirectedFrom = redirectedFrom;
    if (redirectedFrom)
      redirectedFrom._redirectedTo = this;
    this._documentId = documentId;
    this._url = stripFragmentFromUrl(url);
    this._resourceType = resourceType;
    this._method = method;
    this._postData = postData;
    this._headers = headers;
    for (const { name, value } of this._headers)
      this._headersMap.set(name.toLowerCase(), value);
    this._isFavicon = url.endsWith('/favicon.ico');
  }

  _setFailureText(failureText: string) {
    this._failureText = failureText;
    this._waitForResponsePromise.resolve(null);
  }

  url(): string {
    return this._url;
  }

  resourceType(): string {
    return this._resourceType;
  }

  method(): string {
    return this._method;
  }

  postDataBuffer(): Buffer | null {
    return this._postData;
  }

  headers(): types.HeadersArray {
    return this._headers;
  }

  headerValue(name: string): string | undefined {
    return this._headersMap.get(name);
  }

  response(): PromiseLike<Response | null> {
    return this._waitForResponsePromise;
  }

  _existingResponse(): Response | null {
    return this._response;
  }

  _setResponse(response: Response) {
    this._response = response;
    this._waitForResponsePromise.resolve(response);
  }

  _finalRequest(): Request {
    return this._redirectedTo ? this._redirectedTo._finalRequest() : this;
  }

  frame(): frames.Frame {
    return this._frame;
  }

  isNavigationRequest(): boolean {
    return !!this._documentId;
  }

  redirectedFrom(): Request | null {
    return this._redirectedFrom;
  }

  failure(): { errorText: string } | null {
    if (this._failureText === null)
      return null;
    return {
      errorText: this._failureText
    };
  }

  updateWithRawHeaders(headers: types.HeadersArray) {
    this._headers = headers;
    this._headersMap.clear();
    for (const { name, value } of this._headers)
      this._headersMap.set(name.toLowerCase(), value);
    if (!this._headersMap.has('host')) {
      const host = new URL(this._url).host;
      this._headers.push({ name: 'host', value: host });
      this._headersMap.set('host', host);
    }
  }

  bodySize(): number {
    return this.postDataBuffer()?.length || 0;
  }

  headersSize(): number {
    if (!this._response)
      return 0;
    let headersSize = 4; // 4 = 2 spaces + 2 line breaks (GET /path \r\n)
    headersSize += this.method().length;
    headersSize += (new URL(this.url())).pathname.length;
    headersSize += 8; // httpVersion
    for (const header of this._headers)
      headersSize += header.name.length + header.value.length + 4; // 4 = ': ' + '\r\n'
    return headersSize;
  }

  sizes() {
    return {
      requestBodySize: this.bodySize(),
      requestHeadersSize: this.headersSize(),
      responseBodySize: this._sizes.responseBodySize,
      responseHeadersSize: this._existingResponse()!.headersSize(),
      responseTransferSize: this._sizes.transferSize,
    };
  }
}

export class Route extends SdkObject {
  private readonly _request: Request;
  private readonly _delegate: RouteDelegate;
  private _handled = false;
  private _response: InterceptedResponse | null = null;

  constructor(request: Request, delegate: RouteDelegate) {
    super(request.frame(), 'route');
    this._request = request;
    this._delegate = delegate;
  }

  request(): Request {
    return this._request;
  }

  async abort(errorCode: string = 'failed') {
    assert(!this._handled, 'Route is already handled!');
    this._handled = true;
    await this._delegate.abort(errorCode);
  }

  async fulfill(overrides: { status?: number, headers?: types.HeadersArray, body?: string, isBase64?: boolean, useInterceptedResponseBody?: boolean }) {
    assert(!this._handled, 'Route is already handled!');
    this._handled = true;
    let body = overrides.body;
    let isBase64 = overrides.isBase64 || false;
    if (body === undefined) {
      if (this._response && overrides.useInterceptedResponseBody) {
        body = (await this._delegate.responseBody()).toString('utf8');
        isBase64 = false;
      } else {
        body = '';
        isBase64 = false;
      }
    }
    await this._delegate.fulfill({
      status: overrides.status || 200,
      headers: overrides.headers || [],
      body,
      isBase64,
    });
  }

  async continue(overrides: types.NormalizedContinueOverrides = {}): Promise<InterceptedResponse|null> {
    assert(!this._handled, 'Route is already handled!');
    assert(!this._response, 'Cannot call continue after response interception!');
    if (overrides.url) {
      const newUrl = new URL(overrides.url);
      const oldUrl = new URL(this._request.url());
      if (oldUrl.protocol !== newUrl.protocol)
        throw new Error('New URL must have same protocol as overridden URL');
    }
    this._response = await this._delegate.continue(this._request, overrides);
    return this._response;
  }

  async responseBody(): Promise<Buffer> {
    assert(!this._handled, 'Route is already handled!');
    return this._delegate.responseBody();
  }
}

export type RouteHandler = (route: Route, request: Request) => void;

type GetResponseBodyCallback = () => Promise<Buffer>;

export type ResourceTiming = {
  startTime: number;
  domainLookupStart: number;
  domainLookupEnd: number;
  connectStart: number;
  secureConnectionStart: number;
  connectEnd: number;
  requestStart: number;
  responseStart: number;
};

export type RemoteAddr = {
  ipAddress: string;
  port: number;
};

export type SecurityDetails = {
    protocol?: string;
    subjectName?: string;
    issuer?: string;
    validFrom?: number;
    validTo?: number;
};

export class Response extends SdkObject {
  private _request: Request;
  private _contentPromise: Promise<Buffer> | null = null;
  _finishedPromise = new ManualPromise<void>();
  private _status: number;
  private _statusText: string;
  private _url: string;
  private _headers: types.HeadersArray;
  private _headersMap = new Map<string, string>();
  private _getResponseBodyCallback: GetResponseBodyCallback;
  private _timing: ResourceTiming;
  private _serverAddrPromise = new ManualPromise<RemoteAddr | undefined>();
  private _securityDetailsPromise = new ManualPromise<SecurityDetails | undefined>();
  private _extraHeadersPromise: ManualPromise<void> | undefined;
  private _httpVersion: string | undefined;

  constructor(request: Request, status: number, statusText: string, headers: types.HeadersArray, timing: ResourceTiming, getResponseBodyCallback: GetResponseBodyCallback, httpVersion?: string) {
    super(request.frame(), 'response');
    this._request = request;
    this._timing = timing;
    this._status = status;
    this._statusText = statusText;
    this._url = request.url();
    this._headers = headers;
    for (const { name, value } of this._headers)
      this._headersMap.set(name.toLowerCase(), value);
    this._getResponseBodyCallback = getResponseBodyCallback;
    this._request._setResponse(this);
    this._httpVersion = httpVersion;
  }

  _serverAddrFinished(addr?: RemoteAddr) {
    this._serverAddrPromise.resolve(addr);
  }

  _securityDetailsFinished(securityDetails?: SecurityDetails) {
    this._securityDetailsPromise.resolve(securityDetails);
  }

  _requestFinished(responseEndTiming: number) {
    this._request._responseEndTiming = Math.max(responseEndTiming, this._timing.responseStart);
    this._finishedPromise.resolve();
  }

  _setHttpVersion(httpVersion: string) {
    this._httpVersion = httpVersion;
  }

  setWillReceiveExtraHeaders() {
    this._extraHeadersPromise = new ManualPromise();
  }

  willWaitForExtraHeaders(): boolean {
    return !!this._extraHeadersPromise && !this._extraHeadersPromise.isDone();
  }

  async waitForExtraHeadersIfNeeded(): Promise<void> {
    await this._extraHeadersPromise;
  }

  extraHeadersReceived(headers: types.HeadersArray) {
    this._headers = headers;
    for (const { name, value } of this._headers)
      this._headersMap.set(name.toLowerCase(), value);
    this._extraHeadersPromise?.resolve();
  }

  url(): string {
    return this._url;
  }

  status(): number {
    return this._status;
  }

  statusText(): string {
    return this._statusText;
  }

  headers(): types.HeadersArray {
    return this._headers;
  }

  headerValue(name: string): string | undefined {
    return this._headersMap.get(name);
  }

  timing(): ResourceTiming {
    return this._timing;
  }

  async serverAddr(): Promise<RemoteAddr|null> {
    return await this._serverAddrPromise || null;
  }

  async securityDetails(): Promise<SecurityDetails|null> {
    return await this._securityDetailsPromise || null;
  }

  body(): Promise<Buffer> {
    if (!this._contentPromise) {
      this._contentPromise = this._finishedPromise.then(async () => {
        if (this._request._redirectedTo)
          throw new Error('Response body is unavailable for redirect responses');
        return this._getResponseBodyCallback();
      });
    }
    return this._contentPromise;
  }

  request(): Request {
    return this._request;
  }

  frame(): frames.Frame {
    return this._request.frame();
  }

  transferSize(): number | undefined {
    return this._request._sizes.transferSize;
  }

  bodySize(): number {
    return this._request._sizes.responseBodySize;
  }

  httpVersion(): string {
    if (!this._httpVersion)
      return 'HTTP/1.1';
    if (this._httpVersion === 'http/1.1')
      return 'HTTP/1.1';
    return this._httpVersion;
  }

  headersSize(): number {
    let headersSize = 4; // 4 = 2 spaces + 2 line breaks (HTTP/1.1 200 Ok\r\n)
    headersSize += 8; // httpVersion;
    headersSize += 3; // statusCode;
    headersSize += this.statusText().length;
    for (const header of this.headers())
      headersSize += header.name.length + header.value.length + 4; // 4 = ': ' + '\r\n'
    headersSize += 2; // '\r\n'
    return headersSize;
  }
}

export class InterceptedResponse extends SdkObject {
  private readonly _request: Request;
  private readonly _status: number;
  private readonly _statusText: string;
  private readonly _headers: types.HeadersArray;

  constructor(request: Request, status: number, statusText: string, headers: types.HeadersArray) {
    super(request.frame(), 'interceptedResponse');
    this._request = request._finalRequest();
    this._status = status;
    this._statusText = statusText;
    this._headers = headers;
  }

  status(): number {
    return this._status;
  }

  statusText(): string {
    return this._statusText;
  }

  headers(): types.HeadersArray {
    return this._headers;
  }

  request(): Request {
    return this._request;
  }
}

export class WebSocket extends SdkObject {
  private _url: string;

  static Events = {
    Close: 'close',
    SocketError: 'socketerror',
    FrameReceived: 'framereceived',
    FrameSent: 'framesent',
  };

  constructor(parent: SdkObject, url: string) {
    super(parent, 'ws');
    this._url = url;
  }

  url(): string {
    return this._url;
  }

  frameSent(opcode: number, data: string) {
    this.emit(WebSocket.Events.FrameSent, { opcode, data });
  }

  frameReceived(opcode: number, data: string) {
    this.emit(WebSocket.Events.FrameReceived, { opcode, data });
  }

  error(errorMessage: string) {
    this.emit(WebSocket.Events.SocketError, errorMessage);
  }

  closed() {
    this.emit(WebSocket.Events.Close);
  }
}

export interface RouteDelegate {
  abort(errorCode: string): Promise<void>;
  fulfill(response: types.NormalizedFulfillResponse): Promise<void>;
  continue(request: Request, overrides: types.NormalizedContinueOverrides): Promise<InterceptedResponse|null>;
  responseBody(): Promise<Buffer>;
}

// List taken from https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml with extra 306 and 418 codes.
export const STATUS_TEXTS: { [status: string]: string } = {
  '100': 'Continue',
  '101': 'Switching Protocols',
  '102': 'Processing',
  '103': 'Early Hints',
  '200': 'OK',
  '201': 'Created',
  '202': 'Accepted',
  '203': 'Non-Authoritative Information',
  '204': 'No Content',
  '205': 'Reset Content',
  '206': 'Partial Content',
  '207': 'Multi-Status',
  '208': 'Already Reported',
  '226': 'IM Used',
  '300': 'Multiple Choices',
  '301': 'Moved Permanently',
  '302': 'Found',
  '303': 'See Other',
  '304': 'Not Modified',
  '305': 'Use Proxy',
  '306': 'Switch Proxy',
  '307': 'Temporary Redirect',
  '308': 'Permanent Redirect',
  '400': 'Bad Request',
  '401': 'Unauthorized',
  '402': 'Payment Required',
  '403': 'Forbidden',
  '404': 'Not Found',
  '405': 'Method Not Allowed',
  '406': 'Not Acceptable',
  '407': 'Proxy Authentication Required',
  '408': 'Request Timeout',
  '409': 'Conflict',
  '410': 'Gone',
  '411': 'Length Required',
  '412': 'Precondition Failed',
  '413': 'Payload Too Large',
  '414': 'URI Too Long',
  '415': 'Unsupported Media Type',
  '416': 'Range Not Satisfiable',
  '417': 'Expectation Failed',
  '418': 'I\'m a teapot',
  '421': 'Misdirected Request',
  '422': 'Unprocessable Entity',
  '423': 'Locked',
  '424': 'Failed Dependency',
  '425': 'Too Early',
  '426': 'Upgrade Required',
  '428': 'Precondition Required',
  '429': 'Too Many Requests',
  '431': 'Request Header Fields Too Large',
  '451': 'Unavailable For Legal Reasons',
  '500': 'Internal Server Error',
  '501': 'Not Implemented',
  '502': 'Bad Gateway',
  '503': 'Service Unavailable',
  '504': 'Gateway Timeout',
  '505': 'HTTP Version Not Supported',
  '506': 'Variant Also Negotiates',
  '507': 'Insufficient Storage',
  '508': 'Loop Detected',
  '510': 'Not Extended',
  '511': 'Network Authentication Required',
};

export function singleHeader(name: string, value: string): types.HeadersArray {
  return [{ name, value }];
}

export function mergeHeaders(headers: (types.HeadersArray | undefined | null)[]): types.HeadersArray {
  const lowerCaseToValue = new Map<string, string>();
  const lowerCaseToOriginalCase = new Map<string, string>();
  for (const h of headers) {
    if (!h)
      continue;
    for (const { name, value } of h) {
      const lower = name.toLowerCase();
      lowerCaseToOriginalCase.set(lower, name);
      lowerCaseToValue.set(lower, value);
    }
  }
  const result: types.HeadersArray = [];
  for (const [lower, value] of lowerCaseToValue)
    result.push({ name: lowerCaseToOriginalCase.get(lower)!, value });
  return result;
}
