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

// Every time you change this file, update this version.

import * as child_process from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as minimist from 'minimist';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import * as removeFolder from 'rimraf';
import * as browserFetcher from '../server/browserFetcher';

const fsMkdirAsync = util.promisify(fs.mkdir.bind(fs));
const fsReaddirAsync = util.promisify(fs.readdir.bind(fs));
const fsReadFileAsync = util.promisify(fs.readFile.bind(fs));
const fsUnlinkAsync = util.promisify(fs.unlink.bind(fs));
const fsWriteFileAsync = util.promisify(fs.writeFile.bind(fs));
const fsExistsAsync = (path: string) => new Promise(f => fs.exists(path, f));
const removeFolderAsync = util.promisify(removeFolder);

// We are reading this file and are matching against this expression.
const REGISTRY_VERSION = 4;

const baseDir = ((): string => {
  let result: string;
  const env = getFromENV('PLAYWRIGHT_BROWSERS_PATH');
  if (env)
    result = env;
  else if (process.platform === 'linux')
    result = '~/.cache/playwright';
  else if (process.platform === 'darwin')
    result = '~/Library/Caches/playwright';
  else if (process.platform === 'win32')
    result = '~/AppData/Local/playwright';
  else
    throw new Error('Unsupported platform: ' + process.platform);
  if (result.startsWith('~'))
    result = result.replace('~', os.homedir());
  return result;
})();

const linksDir = path.join(baseDir, '.links');
const registryFile = path.join(baseDir, 'registry.js');

(async function main() {
  const argv = minimist(process.argv.slice(2), {});

  if (!argv['nobootstrap']) {
    await bootstrap();
    child_process.fork(registryFile, [ ...argv._, '--nobootstrap' ]);
    return;
  }

  if (argv._[0] === 'install') {
    const packagePath = path.join(process.cwd(), argv._[1], 'package.json');
    logPolitely('Installing browsers for ' + packagePath);
    await fsWriteFileAsync(path.join(linksDir, sha1(packagePath)), packagePath);
    await compact();
    return;
  }

})();

async function bootstrap() {
  logPolitely('Using browsers location: ' + baseDir);
  if (!await fsExistsAsync(baseDir))
    await fsMkdirAsync(baseDir);

  if (!await fsExistsAsync(linksDir))
    await fsMkdirAsync(linksDir);

  try {
    const installedRegistry = (await fsReadFileAsync(registryFile)).toString();
    const installedVersion = parseInt(installedRegistry.match(/const\ REGISTRY_VERSION\ =\ (\d+);/)![1], 10);
    logPolitely(`Installed registry version: ${installedVersion}`);
    logPolitely(`Current registry version:   ${REGISTRY_VERSION}`);
    if (installedVersion >= REGISTRY_VERSION)
      return;
  } catch (e) {
    // not installed.
  }

  logPolitely(`Installing version: ${REGISTRY_VERSION}`);
  await new Promise(f => fs.copyFile(__filename, registryFile, f));
}

async function compact() {
  // 1. Collect unused downloads and package descriptors.
  const directories = new Set((await fsReaddirAsync(baseDir)).map(file => path.join(baseDir, file)));
  directories.delete(path.join(baseDir, '.links'));
  directories.delete(path.join(baseDir, 'registry.js'));

  const descriptors: Descriptor[] = [];
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
      for (const browserName in descriptor.browsers)
        directories.delete(browserFetcher.targetDirectory(baseDir, browserName, descriptor.browsers[browserName]));
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
    for (const browserName in descriptor.browsers) {
      const browserRevision = descriptor.browsers[browserName];
      await browserFetcher.downloadBrowserWithProgressBar({
        baseDir,
        browserName: browserName as browserFetcher.BrowserName,
        browserRevision,
        progressBarName: `${browserName} for playwright v${descriptor.packageVersion}`,
        serverHost,
      });
      logPolitely(`${browserName} is installed at ${browserFetcher.targetDirectory(baseDir, browserName, browserRevision)}`);
    }
  }
}

type Descriptor = {
  packagePath: string,
  packageVersion: string,
  browsers: { [key: string]: string }
};

async function parsePackage(packagePath: string): Promise<Descriptor> {
  const packageJson = JSON.parse((await fsReadFileAsync(packagePath)).toString());
  const versions = packageJson['playwright'];
  return {
    packagePath,
    packageVersion: packageJson['version'],
    browsers: {
      chromium: versions['chromium_revision'],
      firefox: versions['firefox_revision'],
      webkit: versions['webkit_revision']
    }
  };
}

function getFromENV(name: string) {
  let value = process.env[name];
  value = value || process.env[`npm_config_${name.toLowerCase()}`];
  value = value || process.env[`npm_package_config_${name.toLowerCase()}`];
  return value;
}

function sha1(data: string): string {
  const sum = crypto.createHash('sha1');
  sum.update(data);
  return sum.digest('hex');
}

function logPolitely(toBeLogged: string) {
  const logLevel = process.env.npm_config_loglevel;
  const logLevelDisplay = ['silent', 'error', 'warn'].indexOf(logLevel || '') > -1;

  if (!logLevelDisplay)
    console.log(toBeLogged);  // eslint-disable-line no-console
}
