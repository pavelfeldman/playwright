/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
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

import React from 'react';
import { expect, test } from '../test/componentTest';
import { AutoChip, Chip } from './chip';

test.use({ webpack: require.resolve('../webpack.config.js') });

test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 500, height: 500 } });

  test('expand collapse', async ({ render }) => {
    const component = await render(<AutoChip header='title'>
      Chip body
    </AutoChip>);
    await expect(component.locator('text=Chip body')).toBeVisible();
    expect(await component.screenshot()).toMatchSnapshot({ name: 'mobile-expanded.png' });
    await component.locator('text=Title').click();
    await expect(component.locator('text=Chip body')).not.toBeVisible();
    expect(await component.screenshot()).toMatchSnapshot({ name: 'mobile-collapsed.png' });
    await component.locator('text=Title').click();
    await expect(component.locator('text=Chip body')).toBeVisible();
  });
});

test.describe('desktop viewport', () => {
  test.use({ viewport: { width: 720, height: 500 } });

  test('expand collapse', async ({ render }) => {
    const component = await render(<AutoChip header='title'>
      Chip body
    </AutoChip>);
    await expect(component.locator('text=Chip body')).toBeVisible();
    expect(await component.screenshot()).toMatchSnapshot({ name: 'desktop-expanded.png' });
    await component.locator('text=Title').click();
    await expect(component.locator('text=Chip body')).not.toBeVisible();
    expect(await component.screenshot()).toMatchSnapshot({ name: 'desktop-collapsed.png' });
    await component.locator('text=Title').click();
    await expect(component.locator('text=Chip body')).toBeVisible();
  });

  test('render long title', async ({ render }) => {
    const title = 'Extremely long title. '.repeat(10);
    const component = await render(<AutoChip header={title}>
      Chip body
    </AutoChip>);
    await expect(component).toContainText('Extremely long title.');
    await expect(component.locator('text=Extremely long title.')).toHaveAttribute('title', title);
    expect(await component.screenshot()).toMatchSnapshot({ name: 'long-title.png' });
  });

  test('setExpanded is called', async ({ render }) => {
    const expandedValues: boolean[] = [];
    const component = await render(<Chip header='Title'
      setExpanded={(expanded: boolean) => expandedValues.push(expanded)}>
    </Chip>);

    await component.locator('text=Title').click();
    expect(expandedValues).toEqual([true]);
  });

});
