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

import type { Language } from '@isomorphic/locatorGenerators';
import type { Mode, Source } from '@recorder/recorderTypes';
import { SplitView } from '@web/components/splitView';
import type { TabbedPaneTabModel } from '@web/components/tabbedPane';
import { TabbedPane } from '@web/components/tabbedPane';
import { useSetting } from '@web/uiUtils';
import * as React from 'react';
import type { ContextEntry } from '../entries';
import type { Boundaries } from '../geometry';
import { ActionList } from './actionList';
import { ConsoleTab, useConsoleTabModel } from './consoleTab';
import { InspectorTab } from './inspectorTab';
import type * as modelUtil from './modelUtil';
import type { SourceLocation } from './modelUtil';
import { MultiTraceModel } from './modelUtil';
import { NetworkTab, useNetworkTabModel } from './networkTab';
import './recorderView.css';
import type { SnapshotInfo } from './snapshotTab';
import { collectSnapshots, extendSnapshot, fetchSnapshotInfo, kDefaultViewport, SnapshotView } from './snapshotTab';
import { SourceTab } from './sourceTab';
import { Toolbar } from '@web/components/toolbar';
import { ToolbarButton, ToolbarSeparator } from '@web/components/toolbarButton';
import { toggleTheme } from '@web/theme';

const searchParams = new URLSearchParams(window.location.search);
const guid = searchParams.get('ws');
const trace = searchParams.get('trace') + '.json';

export const RecorderView: React.FunctionComponent = () => {
  const [connection, setConnection] = React.useState<Connection | null>(null);
  const [sources, setSources] = React.useState<Source[]>([]);
  React.useEffect(() => {
    const wsURL = new URL(`../${guid}`, window.location.toString());
    wsURL.protocol = (window.location.protocol === 'https:' ? 'wss:' : 'ws:');
    const webSocket = new WebSocket(wsURL.toString());
    setConnection(new Connection(webSocket, { setSources }));
    return () => {
      webSocket.close();
    };
  }, []);

  React.useEffect(() => {
    if (!connection)
      return;
    connection.setMode('recording');
  }, [connection]);

  return <div className='vbox workbench-loader'>
    <TraceView
      traceLocation={trace}
      sources={sources} />
  </div>;
};

export const TraceView: React.FC<{
  traceLocation: string,
  sources: Source[],
}> = ({ traceLocation, sources }) => {
  const [model, setModel] = React.useState<{ model: MultiTraceModel, isLive: boolean } | undefined>();
  const [counter, setCounter] = React.useState(0);
  const pollTimer = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    if (pollTimer.current)
      clearTimeout(pollTimer.current);

    // Start polling running test.
    pollTimer.current = setTimeout(async () => {
      try {
        const model = await loadSingleTraceFile(traceLocation);
        setModel({ model, isLive: true });
      } catch {
        setModel(undefined);
      } finally {
        setCounter(counter + 1);
      }
    }, 500);
    return () => {
      if (pollTimer.current)
        clearTimeout(pollTimer.current);
    };
  }, [counter, traceLocation]);

  const fallbackLocation = React.useMemo(() => {
    if (!sources.length)
      return undefined;
    const fallbackLocation: SourceLocation = {
      file: '',
      line: 0,
      column: 0,
      source: {
        errors: [],
        content: sources[0].text
      }
    };
    return fallbackLocation;
  }, [sources]);

  return <Workbench
    key='workbench'
    model={model?.model}
    fallbackLocation={fallbackLocation}
  />;
};

async function loadSingleTraceFile(url: string): Promise<MultiTraceModel> {
  const params = new URLSearchParams();
  params.set('trace', url);
  const response = await fetch(`contexts?${params.toString()}`);
  const contextEntries = await response.json() as ContextEntry[];
  return new MultiTraceModel(contextEntries);
}

export const Workbench: React.FunctionComponent<{
  model?: modelUtil.MultiTraceModel,
  rootDir?: string,
  fallbackLocation?: modelUtil.SourceLocation,
  revealSource?: boolean,
  showSettings?: boolean,
}> = ({ model, rootDir, fallbackLocation, revealSource, showSettings }) => {
  const [selectedCallId, setSelectedCallId] = React.useState<string | undefined>(undefined);
  const [highlightedAction, setHighlightedAction] = React.useState<modelUtil.ActionTraceEventInContext | undefined>();
  const [selectedPropertiesTab, setSelectedPropertiesTab] = useSetting<string>('recorderPropertiesTab', 'source');
  const [isInspecting, setIsInspectingState] = React.useState(false);
  const [highlightedLocator, setHighlightedLocator] = React.useState<string>('');
  const [selectedTime, setSelectedTime] = React.useState<Boundaries | undefined>();

  const setSelectedAction = React.useCallback((action: modelUtil.ActionTraceEventInContext | undefined) => {
    setSelectedCallId(action?.callId);
  }, []);

  const sources = React.useMemo(() => model?.sources || new Map<string, modelUtil.SourceModel>(), [model]);
  const selectedAction = React.useMemo(() => {
    return model?.actions.find(a => a.callId === selectedCallId);
  }, [model, selectedCallId]);

  const activeAction = React.useMemo(() => {
    return highlightedAction || selectedAction;
  }, [selectedAction, highlightedAction]);

  const onActionSelected = React.useCallback((action: modelUtil.ActionTraceEventInContext) => {
    setSelectedAction(action);
    setHighlightedAction(undefined);
  }, [setSelectedAction, setHighlightedAction]);

  const selectPropertiesTab = React.useCallback((tab: string) => {
    setSelectedPropertiesTab(tab);
    if (tab !== 'inspector')
      setIsInspectingState(false);
  }, [setSelectedPropertiesTab]);

  const setIsInspecting = React.useCallback((value: boolean) => {
    if (!isInspecting && value)
      selectPropertiesTab('inspector');
    setIsInspectingState(value);
  }, [setIsInspectingState, selectPropertiesTab, isInspecting]);

  const locatorPicked = React.useCallback((locator: string) => {
    setHighlightedLocator(locator);
    selectPropertiesTab('inspector');
  }, [selectPropertiesTab]);

  React.useEffect(() => {
    if (revealSource)
      selectPropertiesTab('source');
  }, [revealSource, selectPropertiesTab]);

  const consoleModel = useConsoleTabModel(model, selectedTime);
  const networkModel = useNetworkTabModel(model, selectedTime);
  const sdkLanguage = model?.sdkLanguage || 'javascript';

  const inspectorTab: TabbedPaneTabModel = {
    id: 'inspector',
    title: 'Locator',
    render: () => <InspectorTab
      sdkLanguage={sdkLanguage}
      setIsInspecting={setIsInspecting}
      highlightedLocator={highlightedLocator}
      setHighlightedLocator={setHighlightedLocator} />,
  };

  // Fallback location w/o action stands for file / test.
  // Render error count on Source tab for that case.
  let fallbackSourceErrorCount: number | undefined = undefined;
  if (!selectedAction && fallbackLocation)
    fallbackSourceErrorCount = fallbackLocation.source?.errors.length;

  const sourceTab: TabbedPaneTabModel = {
    id: 'source',
    title: 'Source',
    errorCount: fallbackSourceErrorCount,
    render: () => <SourceTab
      stack={[]}
      sources={sources}
      rootDir={rootDir}
      stackFrameLocation={'right'}
      fallbackLocation={fallbackLocation}
    />
  };
  const consoleTab: TabbedPaneTabModel = {
    id: 'console',
    title: 'Console',
    count: consoleModel.entries.length,
    render: () => <ConsoleTab
      consoleModel={consoleModel}
      boundaries={boundaries}
      selectedTime={selectedTime}
      onAccepted={m => setSelectedTime({ minimum: m.timestamp, maximum: m.timestamp })}
    />
  };
  const networkTab: TabbedPaneTabModel = {
    id: 'network',
    title: 'Network',
    count: networkModel.resources.length,
    render: () => <NetworkTab boundaries={boundaries} networkModel={networkModel} />
  };

  const tabs: TabbedPaneTabModel[] = [
    sourceTab,
    inspectorTab,
    consoleTab,
    networkTab,
  ];

  const { boundaries } = React.useMemo(() => {
    const boundaries = { minimum: model?.startTime || 0, maximum: model?.endTime || 30000 };
    if (boundaries.minimum > boundaries.maximum) {
      boundaries.minimum = 0;
      boundaries.maximum = 30000;
    }
    // Leave some nice free space on the right hand side.
    boundaries.maximum += (boundaries.maximum - boundaries.minimum) / 20;
    return { boundaries };
  }, [model]);

  const actionList = <ActionList
    sdkLanguage={sdkLanguage}
    actions={model?.actions || []}
    selectedAction={model ? selectedAction : undefined}
    selectedTime={selectedTime}
    setSelectedTime={setSelectedTime}
    onSelected={onActionSelected}
    onHighlighted={setHighlightedAction}
    revealConsole={() => selectPropertiesTab('console')}
    isLive={true}
  />;

  const actionsTab: TabbedPaneTabModel = {
    id: 'actions',
    title: 'Actions',
    component: actionList,
  };

  const sidebarTabbedPane = <TabbedPane tabs={[actionsTab]} />;

  const propertiesTabbedPane = <TabbedPane
    tabs={tabs}
    selectedTab={selectedPropertiesTab}
    setSelectedTab={selectPropertiesTab}
  />;

  const snapshotView = <SnapshotContainer
    sdkLanguage={sdkLanguage}
    action={activeAction}
    testIdAttributeName={model?.testIdAttributeName || 'data-testid'}
    isInspecting={isInspecting}
    setIsInspecting={setIsInspecting}
    highlightedLocator={highlightedLocator}
    locatorPicked={locatorPicked} />;

  return <div className='vbox workbench'>
    <Toolbar>
      <ToolbarButton icon='circle-large-filled' title='Record' onClick={() => {
      }}>Record</ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton icon='inspect' title='Pick locator' onClick={() => {
      }} />
      <ToolbarButton icon='eye' title='Assert visibility' onClick={() => {
      }} />
      <ToolbarButton icon='whole-word' title='Assert text' onClick={() => {
      }} />
      <ToolbarButton icon='symbol-constant' title='Assert value' onClick={() => {
      }} />
      <ToolbarSeparator />
      <ToolbarButton icon='files' title='Copy' onClick={() => {
      }} />
      <div style={{ flex: 'auto' }}></div>
      <div>Target:</div>
      {/* <select className='recorder-chooser' hidden={!sources.length} value={fileId} onChange={event => {
        setFileId(event.target.selectedOptions[0].value);
      }}>{renderSourceOptions(sources)}</select> */}
      <ToolbarButton icon='clear-all' title='Clear' onClick={() => {
      }}></ToolbarButton>
      <ToolbarButton icon='color-mode' title='Toggle color mode' toggled={false} onClick={() => toggleTheme()}></ToolbarButton>
    </Toolbar>
    <SplitView
      sidebarSize={250}
      orientation={'horizontal'}
      settingName='recorderActionListSidebar'
      sidebarIsFirst
      main={<SplitView
        sidebarSize={250}
        orientation='vertical'
        settingName='recorderPropertiesSidebar'
        main={snapshotView}
        sidebar={propertiesTabbedPane}
      />}
      sidebar={sidebarTabbedPane}
    />
  </div>;
};

const SnapshotContainer: React.FunctionComponent<{
  sdkLanguage: Language,
  action: modelUtil.ActionTraceEventInContext | undefined,
  testIdAttributeName?: string,
  isInspecting: boolean,
  highlightedLocator: string,
  setIsInspecting: (value: boolean) => void,
  locatorPicked: (locator: string) => void,
}> = ({ sdkLanguage, action, testIdAttributeName, isInspecting, setIsInspecting, highlightedLocator, locatorPicked }) => {
  const [snapshotInfo, setSnapshotInfo] = React.useState<SnapshotInfo>({ viewport: kDefaultViewport, url: '' });
  const snapshot = React.useMemo(() => {
    const snapshot = collectSnapshots(action);
    return snapshot.action || snapshot.after || snapshot.before;
  }, [action]);
  const snapshotUrls = React.useMemo(() => {
    return snapshot ? extendSnapshot(snapshot) : undefined;
  }, [snapshot]);
  React.useEffect(() => {
    fetchSnapshotInfo(snapshotUrls?.snapshotInfoUrl).then(setSnapshotInfo);
  }, [snapshotUrls?.snapshotInfoUrl]);

  return <SnapshotView
    sdkLanguage={sdkLanguage}
    testIdAttributeName={testIdAttributeName || 'data-testid'}
    isInspecting={isInspecting}
    setIsInspecting={setIsInspecting}
    highlightedLocator={highlightedLocator}
    setHighlightedLocator={locatorPicked}
    snapshotUrls={snapshotUrls}
    snapshotInfo={snapshotInfo} />;
};

class Connection {
  private _lastId = 0;
  private _webSocket: WebSocket;
  private _callbacks = new Map<number, { resolve: (arg: any) => void, reject: (arg: Error) => void }>();
  private _options: { setSources: (sources: Source[]) => void; };

  constructor(webSocket: WebSocket, options: { setSources: (sources: Source[]) => void }) {
    this._webSocket = webSocket;
    this._callbacks = new Map();
    this._options = options;

    this._webSocket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const { id, result, error, method, params } = message;
      if (id) {
        const callback = this._callbacks.get(id);
        if (!callback)
          return;
        this._callbacks.delete(id);
        if (error)
          callback.reject(new Error(error));
        else
          callback.resolve(result);
      } else {
        this._dispatchEvent(method, params);
      }
    });
  }

  setMode(mode: Mode) {
    this._sendMessageNoReply('setMode', { mode });
  }

  private async _sendMessage(method: string, params?: any): Promise<any> {
    const id = ++this._lastId;
    const message = { id, method, params };
    this._webSocket.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      this._callbacks.set(id, { resolve, reject });
    });
  }

  private _sendMessageNoReply(method: string, params?: any) {
    this._sendMessage(method, params).catch(() => { });
  }

  private _dispatchEvent(method: string, params?: any) {
    if (method === 'setSources') {
      const { sources } = params as { sources: Source[] };
      this._options.setSources(sources);
      window.playwrightSourcesEchoForTest = sources;
    }
  }
}
