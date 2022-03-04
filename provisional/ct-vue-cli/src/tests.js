import { createApp, setDevtoolsHook, h } from 'vue';
import { initVueTest, registerComponent } from '@playwright/ct-vue';

import Button from './components/Button.vue';
import DefaultSlot from './components/DefaultSlot.vue';
import NamedSlots from './components/NamedSlots.vue';

// This is only needed if you are using Vue CLI (webpack).
// Vite does not need this line.
initVueTest({ createApp, setDevtoolsHook, h });

// Register components.
registerComponent('Button', Button)
registerComponent('DefaultSlot', DefaultSlot)
registerComponent('NamedSlots', NamedSlots)
