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

// Wire format passed through the page binding (JSON-only; binary is base64url).
export type PrfValues = { first: string, second?: string };

export type CreateRequest = {
  type: 'create',
  origin: string,
  challenge: string,
  rp: { id?: string, name: string },
  user: { id: string, name: string, displayName: string },
  pubKeyCredParams: { type: string, alg: number }[],
  excludeCredentials?: { type: string, id: string }[],
  userVerification?: string,
  residentKey?: string,
  prf?: { eval?: PrfValues },
};

export type GetRequest = {
  type: 'get',
  origin: string,
  challenge: string,
  rpId: string,
  allowCredentials?: { type: string, id: string }[],
  userVerification?: string,
  prf?: { eval?: PrfValues, evalByCredential?: Record<string, PrfValues> },
};

export type ClientExtensionResults = {
  prf?: { enabled?: boolean, results?: PrfValues },
};

export type CreateResponse = {
  ok: true,
  id: string,
  clientDataJSON: string,
  attestationObject: string,
  authenticatorData: string,
  publicKey: string,
  prf?: { enabled: boolean, results?: PrfValues },
} | { ok: false, name: string, message: string };

export type GetResponse = {
  ok: true,
  id: string,
  clientDataJSON: string,
  authenticatorData: string,
  signature: string,
  userHandle: string | null,
  prf?: { results: PrfValues },
} | { ok: false, name: string, message: string };

type GlobalThis = typeof globalThis;

export function inject(globalThis: GlobalThis) {
  if ((globalThis as any).__pwWebAuthnInstalled)
    return;
  (globalThis as any).__pwWebAuthnInstalled = true;

  const binding = (globalThis as any).__pwWebAuthnBinding as (payload: any) => Promise<any>;
  if (!binding || !globalThis.navigator)
    return;
  if (!globalThis.navigator.credentials) {
    Object.defineProperty(globalThis.navigator, 'credentials', {
      value: { create: async () => null, get: async () => null },
      writable: true,
      configurable: true,
    });
  }

  function toBase64Url(buf: ArrayBuffer | ArrayBufferView): string {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    let s = '';
    for (let i = 0; i < bytes.length; i++)
      s += String.fromCharCode(bytes[i]);
    return globalThis.btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  }

  function fromBase64Url(s: string): ArrayBuffer {
    let str = s.replaceAll('-', '+').replaceAll('_', '/');
    while (str.length % 4)
      str += '=';
    const bin = globalThis.atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
      out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  const PublicKeyCredentialCtor: any = (globalThis as any).PublicKeyCredential;
  const AuthAttestationResponseCtor: any = (globalThis as any).AuthenticatorAttestationResponse;
  const AuthAssertionResponseCtor: any = (globalThis as any).AuthenticatorAssertionResponse;

  function defineReadonly(target: any, props: Record<string, any>) {
    for (const k of Object.keys(props))
      Object.defineProperty(target, k, { value: props[k], enumerable: true, configurable: true });
  }

  function makeAttestationResponse(clientDataJSON: ArrayBuffer, attestationObject: ArrayBuffer, authenticatorData: ArrayBuffer, publicKey: ArrayBuffer) {
    const proto = AuthAttestationResponseCtor?.prototype || Object.prototype;
    const r = Object.create(proto);
    defineReadonly(r, { clientDataJSON, attestationObject });
    r.getTransports = () => ['internal'];
    r.getAuthenticatorData = () => authenticatorData;
    r.getPublicKey = () => publicKey;
    r.getPublicKeyAlgorithm = () => -7;
    return r;
  }

  function makeAssertionResponse(clientDataJSON: ArrayBuffer, authenticatorData: ArrayBuffer, signature: ArrayBuffer, userHandle: ArrayBuffer | null) {
    const proto = AuthAssertionResponseCtor?.prototype || Object.prototype;
    const r = Object.create(proto);
    defineReadonly(r, { clientDataJSON, authenticatorData, signature, userHandle });
    return r;
  }

  function makePublicKeyCredential(id: string, response: any, responseToJSON: () => Record<string, any>, extensionResults: ClientExtensionResults) {
    const proto = PublicKeyCredentialCtor?.prototype || Object.prototype;
    const cred = Object.create(proto);
    defineReadonly(cred, {
      id,
      rawId: fromBase64Url(id),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response,
    });
    cred.getClientExtensionResults = () => {
      const results: Record<string, any> = {};
      if (extensionResults.prf) {
        results.prf = { ...extensionResults.prf };
        if (extensionResults.prf.results)
          results.prf.results = fromBase64UrlValues(extensionResults.prf.results);
      }
      return results;
    };
    // https://w3c.github.io/webauthn/#dom-publickeycredential-tojson
    cred.toJSON = () => ({
      id,
      rawId: id,
      response: responseToJSON(),
      authenticatorAttachment: 'platform',
      clientExtensionResults: extensionResults,
      type: 'public-key',
    });
    return cred;
  }

  function toBase64UrlValues(values: any): PrfValues | undefined {
    if (!values || values.first === undefined)
      return undefined;
    return { first: toBase64Url(toBuf(values.first)), ...(values.second !== undefined ? { second: toBase64Url(toBuf(values.second)) } : {}) };
  }

  function fromBase64UrlValues(values: PrfValues) {
    return { first: fromBase64Url(values.first), ...(values.second !== undefined ? { second: fromBase64Url(values.second) } : {}) };
  }

  function toBuf(x: ArrayBuffer | ArrayBufferView | undefined): ArrayBuffer {
    if (!x)
      return new ArrayBuffer(0);
    if (x instanceof ArrayBuffer)
      return x;
    const v = x as ArrayBufferView;
    const out = new Uint8Array(v.byteLength);
    out.set(new Uint8Array(v.buffer as ArrayBuffer, v.byteOffset, v.byteLength));
    return out.buffer;
  }

  function failure(name: string, message: string): never {
    const Ctor: any = (globalThis as any).DOMException || Error;
    throw new Ctor(message, name);
  }

  const origCreate = globalThis.navigator.credentials.create.bind(globalThis.navigator.credentials);
  const origGet = globalThis.navigator.credentials.get.bind(globalThis.navigator.credentials);

  globalThis.navigator.credentials.create = async function(options?: CredentialCreationOptions): Promise<Credential | null> {
    if (!options || !(options as any).publicKey)
      return origCreate(options);
    const pk = (options as any).publicKey;
    const req: CreateRequest = {
      type: 'create',
      origin: globalThis.location.origin,
      challenge: toBase64Url(toBuf(pk.challenge)),
      rp: { id: pk.rp?.id, name: pk.rp?.name || '' },
      user: {
        id: toBase64Url(toBuf(pk.user?.id)),
        name: pk.user?.name || '',
        displayName: pk.user?.displayName || '',
      },
      pubKeyCredParams: (pk.pubKeyCredParams || []).map((p: any) => ({ type: p.type, alg: p.alg })),
      excludeCredentials: (pk.excludeCredentials || []).map((c: any) => ({ type: c.type, id: toBase64Url(toBuf(c.id)) })),
      userVerification: pk.authenticatorSelection?.userVerification,
      residentKey: pk.authenticatorSelection?.residentKey,
    };
    if (pk.extensions?.prf)
      req.prf = { eval: toBase64UrlValues(pk.extensions.prf.eval) };
    const result: CreateResponse = await binding(req);
    if (!result.ok)
      failure(result.name, result.message);
    const resp = makeAttestationResponse(
        fromBase64Url(result.clientDataJSON),
        fromBase64Url(result.attestationObject),
        fromBase64Url(result.authenticatorData),
        fromBase64Url(result.publicKey),
    );
    return makePublicKeyCredential(result.id, resp, () => ({
      clientDataJSON: result.clientDataJSON,
      authenticatorData: result.authenticatorData,
      transports: resp.getTransports(),
      publicKey: result.publicKey,
      publicKeyAlgorithm: resp.getPublicKeyAlgorithm(),
      attestationObject: result.attestationObject,
    }), result.prf ? { prf: result.prf } : {});
  };

  globalThis.navigator.credentials.get = async function(options?: CredentialRequestOptions): Promise<Credential | null> {
    if (!options || !(options as any).publicKey)
      return origGet(options);
    const pk = (options as any).publicKey;
    const req: GetRequest = {
      type: 'get',
      origin: globalThis.location.origin,
      challenge: toBase64Url(toBuf(pk.challenge)),
      rpId: pk.rpId || new URL(globalThis.location.origin).hostname,
      allowCredentials: (pk.allowCredentials || []).map((c: any) => ({ type: c.type, id: toBase64Url(toBuf(c.id)) })),
      userVerification: pk.userVerification,
    };
    if (pk.extensions?.prf) {
      const evalByCredential: Record<string, PrfValues> = {};
      for (const [credentialId, values] of Object.entries(pk.extensions.prf.evalByCredential || {})) {
        const prfValues = toBase64UrlValues(values);
        if (prfValues)
          evalByCredential[credentialId] = prfValues;
      }
      req.prf = { eval: toBase64UrlValues(pk.extensions.prf.eval), evalByCredential };
    }
    const result: GetResponse = await binding(req);
    if (!result.ok)
      failure(result.name, result.message);
    const resp = makeAssertionResponse(
        fromBase64Url(result.clientDataJSON),
        fromBase64Url(result.authenticatorData),
        fromBase64Url(result.signature),
        result.userHandle ? fromBase64Url(result.userHandle) : null,
    );
    return makePublicKeyCredential(result.id, resp, () => ({
      clientDataJSON: result.clientDataJSON,
      authenticatorData: result.authenticatorData,
      signature: result.signature,
      ...(result.userHandle ? { userHandle: result.userHandle } : {}),
    }), result.prf ? { prf: result.prf } : {});
  };

  if (PublicKeyCredentialCtor) {
    PublicKeyCredentialCtor.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
    PublicKeyCredentialCtor.isConditionalMediationAvailable = async () => true;
  }
}
