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

const browserPaths = require('./lib/registry/browserPaths.js');
const { getFromENV, logPolitely } = require('./lib/helper.js');
const packageJSON = require('./package.json');

function createBrowser(browserName) {
  return {
    name: browserName,
    revision: packageJSON.playwright[`${browserName}_revision`],
    platform: browserPaths.hostPlatform
  };
}

function executablePath(browserName) {
  return browserPaths.executablePath(createBrowser(browserName));
}

async function downloadBrowserWithProgressBar(browserName) {
  if (getFromENV('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD')) {
    logPolitely('Skipping browsers download because `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` env variable is set');
    return false;
  }


  child.on('exit', function() {
    process.exit()
  })
  return browserFetcher.downloadBrowserWithProgressBar({
    base: createBrowser(browserName),
    progressBarName: `${browserName} for playwright v${packageJSON.version}`,
    serverHost: getFromENV('PLAYWRIGHT_DOWNLOAD_HOST'),
  });
}

module.exports = { executablePath, downloadBrowserWithProgressBar };
