// /*
//   Copyright (c) Microsoft Corporation.

//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at

//       http://www.apache.org/licenses/LICENSE-2.0

//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.
// */

// import * as React from 'react';
// import { ListView } from './listView';

// export type TreeViewProps = {
//   items: any[],
//   itemKey: (item: any) => string,
//   itemRender: (item: any) => React.ReactNode,
//   itemIcon: (item: any) => string | undefined,
//   itemChildren: (item: any) => any[],
//   selectedItem?: any,
//   highlightedItem?: any,
//   onSelected?: (item: any) => void,
//   onHighlighted?: (item: any | undefined) => void,
// };

// export const TreeView: React.FC<TreeViewProps> = ({
//   items = [],
//   itemKey,
//   itemRender,
//   itemIcon,
//   itemChildren,
//   selectedItem,
//   highlightedItem,
//   onSelected = () => {},
//   onHighlighted = () => {},
// }) => {

//   return <ListView
//     items={entries}
//     itemKey={itemKey}
//     itemRender={itemRender}
//     itemIcon={itemIcon}
//     highlightedItem={highlightedItem}
//     selectedItem={selectedItem}
//     onHighlighted={onHighlighted}
//     onSelected={onSelected}></ListView>;
// };
