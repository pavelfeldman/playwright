/*
  Copyright (c) Microsoft Corporation.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import './report.css';
import * as React from 'react';
import { SplitView } from '../components/splitView';
import { Expandable } from '../components/expandable';
import { TreeItem } from '../components/treeItem';

declare global {
  interface Window {
  }
}

export interface ReportProps {
}

export const Report: React.FC<ReportProps> = ({
}) => {
  return <div className='hbox'>
    <Sidebar items={['Overview', 'Categories', 'Suites', 'Graphs', 'Timeline', 'Behaviors', 'Packages']}></Sidebar>
    <SplitView sidebarSize={300} orientation='horizontal' sidebarIsFirst={true}>
      <div>No item selected</div>
      <SuiteTree items={['Desktop Chrome', 'Mobile Safari', 'Firefox']}></SuiteTree>
    </SplitView>
  </div>;
};


export interface SidebarProps {
  items: string[];
}

const Sidebar: React.FC<SidebarProps> = ({
  items,
}) => {
  const [selectedItem, setSelectedItem] = React.useState<string>(items[0]);
  return <div className='sidebar'>
    {
      items.map(item => {
        const selected = item === selectedItem;
        return <div key={item} className={selected ? 'selected' : ''} onClick={e => {
          setSelectedItem(item);
        }}>{item}</div>
      })
    }
  </div>;
};

const SuiteTree: React.FC<{
  items: string[];
}> = ({ items }) => {
  return <div className='suite-tree'>
    {
      items.map(item => <TreeItem key={item} title={<div>{item}</div>} body={
        <div className='vbox'>
          <TreeItem title={<div>page/page-click.spec.ts</div>} body={
            <TreeItem title={<div>#1 should click the button</div>}></TreeItem>
          }>
          </TreeItem>
        </div>
      }></TreeItem>)
    }
  </div>;
};
