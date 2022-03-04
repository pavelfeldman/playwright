import { registerComponent } from '@playwright/ct-vue';

import Button from './components/Button.vue';
import DefaultSlot from './components/DefaultSlot.vue';
import NamedSlots from './components/NamedSlots.vue';

registerComponent('Button', Button)
registerComponent('DefaultSlot', DefaultSlot)
registerComponent('NamedSlots', NamedSlots)
