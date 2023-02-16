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

import '@web/third_party/vscode/codicon.css';
import { loadSingleTraceFile, Workbench, WorkbenchLoader } from './ui/workbench';
import * as ReactDOM from 'react-dom';
import { applyTheme } from '@web/theme';
import '@web/common.css';
import React from 'react';
import { ListView } from '@web/components/listView';
import { TeleReporterReceiver } from './teleReceiver';
import type { FullConfig, Suite, TestCase, TestStep } from '../../playwright-test/types/testReporter';
import { SplitView } from '@web/components/splitView';
import type { MultiTraceModel } from './ui/modelUtil';

let rootSuite: Suite | undefined;

let updateList: () => void = () => {};
let updateProgress: () => void = () => {};

export const RootView: React.FC<{}> = ({
}) => {
  const [updateCounter, setUpdateCounter] = React.useState(0);
  updateList = () => setUpdateCounter(updateCounter + 1);
  const [selectedFileSuite, setSelectedFileSuite] = React.useState<Suite | undefined>();
  const [selectedTest, setSelectedTest] = React.useState<TestCase | undefined>();
  const [isRunningTest, setIsRunningTest] = React.useState<boolean>(false);

  const selectedOrDefaultFileSuite = selectedFileSuite || rootSuite?.suites?.[0]?.suites?.[0];
  if (window.location.href.includes('watchMode=true')) {
    const tests: TestCase[] = [];
    const fileSuites: Suite[] = [];

    for (const projectSuite of rootSuite?.suites || []) {
      for (const fileSuite of projectSuite.suites) {
        if (fileSuite === selectedOrDefaultFileSuite)
          tests.push(...fileSuite.allTests());
        fileSuites.push(fileSuite);
      }
    }

    return <SplitView sidebarSize={150} orientation='horizontal' sidebarIsFirst={true}>
      <SplitView sidebarSize={200} orientation='horizontal' sidebarIsFirst={true}>
        <TraceView test={selectedTest} isRunningTest={isRunningTest}></TraceView>
        {/* <SplitView sidebarSize={300} orientation='vertical' sidebarIsFirst={false}>
          <ProgressView test={selectedTest}></ProgressView>
        </SplitView> */}
        <ListView
          items={tests}
          itemKey={(test: TestCase) => test.id }
          itemRender={(test: TestCase) => test.title }
          itemIcon={(test: TestCase) => {
            if (test.results.length && test.results[0].duration)
              return test.ok() ? 'codicon-check' : 'codicon-error';
            if (test.results.length)
              return 'codicon-loading';
          }}
          selectedItem={selectedTest}
          onAccepted={(test: TestCase) => {
            setSelectedTest(test);
            setIsRunningTest(true);
            runTests(test.location.file + ':' + test.location.line).then(() => {
              setIsRunningTest(false);
            });
          }}
          onSelected={(test: TestCase) => {
            setSelectedTest(test);
          }}
          showNoItemsMessage={true}></ListView>
      </SplitView>
      <ListView
        items={fileSuites}
        itemKey={(fileSuite: Suite) => fileSuite.title }
        itemRender={(fileSuite: Suite) => fileSuite.title}
        itemIcon={(fileSuite: Suite) => {
          const tests = fileSuite.allTests();
          const goodTests = tests.filter(t => t.ok() && t.results.length && t.results[0].duration);
          if (goodTests.length === tests.length)
            return 'codicon-check';
          const hasUnexpected = tests.some(t => t.outcome() === 'unexpected');
          if (hasUnexpected)
            return 'codicon-error';
        }}
        selectedItem={selectedOrDefaultFileSuite}
        onAccepted={(fileSuite: Suite) => {
          runTests(fileSuite.title);
        }}
        onSelected={(fileSuite: Suite) => setSelectedFileSuite(fileSuite)}
        showNoItemsMessage={true}></ListView>
    </SplitView>;
  } else {
    return <WorkbenchLoader/>;
  }
};

export const ProgressView: React.FC<{
  test: TestCase | undefined,
}> = ({
  test,
}) => {
  const [updateCounter, setUpdateCounter] = React.useState(0);
  updateProgress = () => setUpdateCounter(updateCounter + 1);

  const steps: (TestCase | TestStep)[] = [];
  for (const result of test?.results || [])
    steps.push(...result.steps);

  console.log('UPDATING PROGRESS')
  return <ListView
    items={steps}
    itemKey={(step: TestStep) => (step as any).id }
    itemRender={(step: TestStep) => step.title}
    itemIcon={(step: TestStep) => step.error ? 'codicon-error' : 'codicon-check'}
  ></ListView>;
};

export const TraceView: React.FC<{
  test: TestCase | undefined,
  isRunningTest: boolean,
}> = ({ test, isRunningTest }) => {
  const [model, setModel] = React.useState<MultiTraceModel | undefined>();

  React.useEffect(() => {
    (async () => {
      if (!test) {
        setModel(undefined);
        return;
      }
      for (const result of test.results) {
        const attachment = result.attachments.find(a => a.name === 'trace');
        if (attachment && attachment.path) {
          console.log('GOOD MODEL', attachment.path);
          setModel(await loadSingleTraceFile(attachment.path));
          return;
        }
      }
      setModel(undefined);
    })();
  }, [test, isRunningTest]);

  if (isRunningTest)
    return <ProgressView test={test}></ProgressView>;

  if (!model) {
    return <div className='vbox'>
      <div className='drop-target'>
        <div>Run test to see the trace</div>
        <div style={{ paddingTop: 20 }}>
          <div>Double click a test or hit Enter</div>
        </div>
      </div>
    </div>;
  }

  return <Workbench model={model} view='embedded'></Workbench>;

};

declare global {
  interface Window {
    binding(data: any): Promise<void>;
  }
}

const receiver = new TeleReporterReceiver({
  onBegin: (config: FullConfig, suite: Suite) => {
    if (!rootSuite)
      rootSuite = suite;
    updateList();
  },

  onTestBegin: () => {
    updateList();
  },

  onTestEnd: () => {
    updateList();
  },

  onStepBegin: () => {
    console.log('STEP BEGIN');
    updateProgress();
  },

  onStepEnd: () => {
    console.log('STEP END');
    updateProgress();
  },
});


(window as any).dispatch = (message: any) => {
  receiver.dispatch(message);
};

(async () => {
  applyTheme();
  if (window.location.protocol !== 'file:') {
    if (window.location.href.includes('isUnderTest=true'))
      await new Promise(f => setTimeout(f, 1000));
    navigator.serviceWorker.register('sw.bundle.js');
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>(f => {
        navigator.serviceWorker.oncontrollerchange = () => f();
      });
    }

    // Keep SW running.
    setInterval(function() { fetch('ping'); }, 10000);
  }

  ReactDOM.render(<RootView></RootView>, document.querySelector('#root'));
})();

async function runTests(location: string): Promise<void> {
  await (window as any).binding({
    method: 'run',
    params: { location }
  });
}
