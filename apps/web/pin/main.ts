import { createApp } from 'vue';
import { IconResolverKey } from '@vendor/app-ui';
import { getIcon, type IconName } from '@vendor/app-client/icons';
import '@vendor/app-ui/style.css';
import './pin.css';
import PinnedScreenshot from './PinnedScreenshot.vue';

const app = createApp(PinnedScreenshot);
app.provide(IconResolverKey, (name) => getIcon(name as IconName)?.component);
app.mount('#app');
