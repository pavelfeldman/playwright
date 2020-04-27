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

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as minimist from 'minimist';
import * as path from 'path';
import * as util from 'util';
import * as removeFolder from 'rimraf';
import * as browserFetcher from '../browserFetcher';
import * as browserPaths from '../browserPaths';
import { REGISTRY_APP_VERSION } from './registryAppVersion';
import { getFromENV, logPolitely } from '../../helper';

const fsMkdirAsync = util.promisify(fs.mkdir.bind(fs));
const fsReaddirAsync = util.promisify(fs.readdir.bind(fs));
const fsReadFileAsync = util.promisify(fs.readFile.bind(fs));
const fsUnlinkAsync = util.promisify(fs.unlink.bind(fs));
const fsWriteFileAsync = util.promisify(fs.writeFile.bind(fs));
const fsExistsAsync = (path: string) => new Promise(f => fs.exists(path, f));
const removeFolderAsync = util.promisify(removeFolder);

const baseDir = browserPaths.baseDir;
const linksDir = path.join(baseDir, '.links');

// Every time you change this file, update the registryVersion.ts.

(async function main() {
  const argv = minimist(process.argv.slice(2), {});

  if (!await fsExistsAsync(linksDir))
    await fsMkdirAsync(linksDir);

  if (argv._[0] === 'install') {
    const packagePath = path.join(process.cwd(), argv._[1], 'package.json');
    logPolitely(`Registry v${REGISTRY_APP_VERSION} installing browsers for ${packagePath}`);
    await fsWriteFileAsync(path.join(linksDir, sha1(packagePath)), packagePath);
    await compact();
    return;
  }

})();

async function compact() {
  // 1. Collect unused downloads and package descriptors.
  const directories = new Set((await fsReaddirAsync(baseDir)).map(file => path.join(baseDir, file)));
  directories.delete(path.join(baseDir, '.links'));
  directories.delete(path.join(baseDir, 'registryApp.js'));

  const descriptors: ClientDescriptor[] = [];
  for (const fileName of await fsReaddirAsync(linksDir)) {
    const linkPath = path.join(linksDir, fileName);
    try {
      const packagePath = (await fsReadFileAsync(linkPath)).toString();
      if (!path.isAbsolute(packagePath))
        throw new Error(`Link can't be absolute path`);
      if (!await fsExistsAsync(packagePath))
        throw new Error(`Link is gone`);
      // Parse the package link points to.
      const descriptor = await parsePackage(packagePath);
      for (const browser of descriptor.browsers)
        directories.delete(browserPaths.browserDirectory(browser));
      descriptors.push(descriptor);
    } catch (e) {
      console.error('Failed to process descriptor at ' + fileName);
      try {
        await fsUnlinkAsync(linkPath);
      } catch (e) {}
    }
  }

  // 2. Delete all unused browsers.
  for (const directory of directories) {
    logPolitely('Removing unused browser at ' + directory);
    await removeFolderAsync(directory);
  }

  // 3. Install missing browsers.
  const serverHost = getFromENV('PLAYWRIGHT_DOWNLOAD_HOST');
  for (const descriptor of descriptors) {
    for (const browser of descriptor.browsers) {
      await browserFetcher.downloadBrowserWithProgressBar({
        browser,
        progressBarName: `${browser.name} for playwright v${descriptor.packageVersion}`,
        serverHost,
      });
      logPolitely(`${browser.name} is installed at ${browserPaths.browserDirectory(browser)}`);
    }
  }
}

type ClientDescriptor = {
  packagePath: string,
  packageVersion: string,
  browsers: browserPaths.BrowserDescriptor[]
};

async function parsePackage(packagePath: string): Promise<ClientDescriptor> {
  const packageJson = JSON.parse((await fsReadFileAsync(packagePath)).toString());
  const revisions = packageJson['playwright'];
  const result: ClientDescriptor = {
    packagePath,
    packageVersion: packageJson['version'],
    browsers: []
  };
  for (const name of ['chromium', 'firefox', 'webkit']) {
    result.browsers.push({
      name,
      revision: revisions[`${name}_revision`],
      platform: browserPaths.hostPlatform
    });
  }
  return result;
}

function sha1(data: string): string {
  const sum = crypto.createHash('sha1');
  sum.update(data);
  return sum.digest('hex');
}
