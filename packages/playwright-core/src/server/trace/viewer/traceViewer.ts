/**
 * Copyright (c) Microsoft Corporation.
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

import path from 'path';
import fs from 'fs';
import * as consoleApiSource from '../../../generated/consoleApiSource';
import { HttpServer } from '../../../utils/httpServer';
import { findChromiumChannel } from '../../registry';
import { isUnderTest } from '../../../utils';
import { installAppIcon, syncLocalStorageWithSettings } from '../../chromium/crApp';
import { serverSideCallMetadata } from '../../instrumentation';
import { createPlaywright } from '../../playwright';
import { ProgressController } from '../../progress';
import { yazl } from '../../../zipBundle';
import type { Page } from '../../page';
import EventEmitter from 'events';
import type * as http from 'http';

type Options = { app?: string, headless?: boolean, host?: string, port?: number };

let TTT = 0;

export async function showTraceViewer(traceUrls: string[], browserName: string, options?: Options): Promise<Page> {
  const { headless = false, host, port, app } = options || {};
  for (const traceUrl of traceUrls) {
    if (!traceUrl.startsWith('http://') && !traceUrl.startsWith('https://') && !fs.existsSync(traceUrl) && !fs.existsSync(traceUrl + '.trace')) {
      // eslint-disable-next-line no-console
      console.error(`Trace file ${traceUrl} does not exist!`);
      process.exit(1);
    }
  }
  const server = new HttpServer();
  server.routePrefix('/trace', (request, response) => {
    const url = new URL('http://localhost' + request.url!);
    console.log('REQUEST', String(url));
    const relativePath = url.pathname.slice('/trace'.length);
    if (relativePath.endsWith('/stall.js'))
      return true;
    if (relativePath.startsWith('/file')) {
      TTT = performance.now();
      try {
        const filePath = url.searchParams.get('path')!;
        if (fs.existsSync(filePath))
          return server.serveFile(request, response, url.searchParams.get('path')!);
        if (fs.existsSync(filePath + '.trace')) {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/octet-stream');
          // response.end('AAA');
          // const buffer = Buffer.from('Hello World!', 'utf-8');
          // const bufferStream = Readable.from(buffer);
          // bufferStream.pipe(response);
          pipeZip(filePath, response);
          return true;
        }
      } catch (e) {
        return false;
      }
    }
    const absolutePath = path.join(__dirname, '..', '..', '..', 'webpack', 'traceViewer', ...relativePath.split('/'));
    return server.serveFile(request, response, absolutePath);
  });

  const urlPrefix = await server.start({ preferredPort: port, host });

  const traceViewerPlaywright = createPlaywright('javascript', true);
  const traceViewerBrowser = isUnderTest() ? 'chromium' : browserName;
  const args = traceViewerBrowser === 'chromium' ? [
    '--app=data:text/html,',
    '--window-size=1280,800',
    '--test-type=',
  ] : [];

  const context = await traceViewerPlaywright[traceViewerBrowser as 'chromium'].launchPersistentContext(serverSideCallMetadata(), '', {
    // TODO: store language in the trace.
    channel: findChromiumChannel(traceViewerPlaywright.options.sdkLanguage),
    args,
    noDefaultViewport: true,
    ignoreDefaultArgs: ['--enable-automation'],
    headless,
    colorScheme: 'no-override',
    useWebSocket: isUnderTest(),
  });

  const controller = new ProgressController(serverSideCallMetadata(), context._browser);
  await controller.run(async progress => {
    await context._browser._defaultContext!._loadDefaultContextAsIs(progress);
  });
  await context.extendInjectedScript(consoleApiSource.source);
  const [page] = context.pages();

  if (isUnderTest())
    process.stderr.write('DevTools listening on: ' + context._browser.options.wsEndpoint + '\n');

  if (traceViewerBrowser === 'chromium')
    await installAppIcon(page);
  if (!isUnderTest())
    await syncLocalStorageWithSettings(page, 'traceviewer');

  const params = traceUrls.map(t => `trace=${t}`);
  if (isUnderTest()) {
    params.push('isUnderTest=true');
    page.on('close', () => context.close(serverSideCallMetadata()).catch(() => {}));
  } else {
    page.on('close', () => process.exit());
  }

  const searchQuery = params.length ? '?' + params.join('&') : '';
  await page.mainFrame().goto(serverSideCallMetadata(), urlPrefix + `/trace/${app || 'index.html'}${searchQuery}`);
  return page;
}

function pipeZip(traceName: string, response: http.ServerResponse) {
  const zipFile = new yazl.ZipFile();
  (zipFile as any as EventEmitter).on('error', error => console.error(error));

  if (fs.existsSync(traceName + '.trace'))
    zipFile.addBuffer(fs.readFileSync(traceName + '.trace'), 'trace.trace', { compress: false });
  if (fs.existsSync(traceName + '.network'))
    zipFile.addBuffer(fs.readFileSync(traceName + '.network'), 'trace.network', { compress: false });
  if (fs.existsSync(traceName + '.stacks'))
    zipFile.addBuffer(fs.readFileSync(traceName + '.stacks'), 'trace.stacks', { compress: false });
  const resources = path.resolve(traceName, '../resources');
  for (const file of fs.readdirSync(resources)) {
    try {
      zipFile.addFile(path.join(resources, file), 'resources/' + file, { compress: false });
    } catch (e) {
      console.log(e);
    }
  }
  zipFile.addBuffer(Buffer.from(resources), 'trace.basedir', { compress: false });
  zipFile.end(undefined, () => zipFile.outputStream.pipe(response).on('close', () => console.log(performance.now() - TTT)));
}
