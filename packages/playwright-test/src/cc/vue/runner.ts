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

import webpack from 'webpack';
import path from 'path';

const cwd = process.cwd();
const indexHtml = path.join(cwd, 'public', 'index.html');
const folioHtml = path.join(cwd, 'folio', 'folio.html');
const folioJs = path.join(cwd, 'folio', 'folio.js');
const folioOutput = path.join(cwd, 'dist-folio');

function loadWebpackConfig() {
  const webpackConfig = require(path.join(process.cwd(), 'node_modules', '@vue/cli-service/webpack.config.js'));

  // Patch config to use folio.html and folio.js for our app.
  for (const plugin of webpackConfig.plugins) {
    if (plugin?.userOptions?.template === indexHtml)
      plugin.userOptions.template = folioHtml;
  }

  webpackConfig.output.path = folioOutput;
  webpackConfig.entry = {
    folio: folioJs
  };
  return webpackConfig;
}

export function build() {
  const wp = webpack(loadWebpackConfig());
  wp.run((err, stats) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
  });
};

export function watch() {
  const wp = webpack(loadWebpackConfig());
  wp.watch({ aggregateTimeout: 500 }, (err, stats) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
  });
};
