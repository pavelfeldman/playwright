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

import WebSocket from 'ws';
import { test as it, expect } from './pageTest';

it('video.startServer should return url and stop cleanly', async ({ page }) => {
  const { url } = await page.video().startServer();
  expect(url).toContain('http://');
  await page.video().stopServer();
});

it('video.startServer should deliver frames over WebSocket', async ({ page }) => {
  const { url } = await page.video().startServer();

  await page.goto('data:text/html,<body style="background:red"></body>');
  await page.evaluate(() => new Promise(f => { let n = 5; const loop = () => --n ? requestAnimationFrame(loop) : f(undefined); loop(); }));

  const frame = await new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(url.replace('http://', 'ws://') + '/ws');
    ws.on('message', (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'frame') {
        ws.close();
        resolve(msg);
      }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); reject(new Error('Timed out waiting for frame')); }, 10000);
  });

  expect(frame.type).toBe('frame');
  expect(frame.data).toBeTruthy();
  // Verify it's valid base64-encoded JPEG (starts with /9j/)
  expect(frame.data.startsWith('/9j/')).toBeTruthy();

  await page.video().stopServer();
});

it('video.startServer should send cached frame to late-joining client', async ({ page }) => {
  const { url } = await page.video().startServer();

  await page.goto('data:text/html,<body style="background:blue"></body>');
  await page.evaluate(() => new Promise(f => { let n = 5; const loop = () => --n ? requestAnimationFrame(loop) : f(undefined); loop(); }));

  // Wait for at least one frame to be produced by connecting a first client.
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url.replace('http://', 'ws://') + '/ws');
    ws.on('message', (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'frame') {
        ws.close();
        resolve();
      }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); reject(new Error('Timed out')); }, 10000);
  });

  // Now connect a second client — it should get the cached frame immediately.
  const frame = await new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(url.replace('http://', 'ws://') + '/ws');
    ws.on('message', (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'frame') {
        ws.close();
        resolve(msg);
      }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); reject(new Error('Timed out waiting for cached frame')); }, 5000);
  });

  expect(frame.data).toBeTruthy();

  await page.video().stopServer();
});

it('video.startServer should fail when server is already running', async ({ page }) => {
  await page.video().startServer();
  const error = await page.video().startServer().catch(e => e);
  expect(error.message).toContain('Video server is already running');
  await page.video().stopServer();
});

it('video.stopServer should fail when server is not running', async ({ page }) => {
  const error = await page.video().stopServer().catch(e => e);
  expect(error.message).toContain('Video server is not running');
});
