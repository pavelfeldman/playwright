import { registerComponent } from '@playwright/ct-svelte';

import App from './App.svelte';
import ContactCard from './lib/ContactCard.svelte';
import Counter from './lib/Counter.svelte';

registerComponent('App', App);
registerComponent('Counter', Counter);
registerComponent('ContactCard', ContactCard);
