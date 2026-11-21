import { createApp } from 'vue';
import { IconResolverKey } from '@vendor/app-ui';
import { createKimiI18n } from '@vendor/app-i18n';
import { getIcon, type IconName } from '@vendor/app-client/icons';
import '@vendor/app-ui/style.css';
import './screenshot.css';
import ScreenshotOverlay from './ScreenshotOverlay.vue';

const app = createApp(ScreenshotOverlay);
app.use(createKimiI18n({}));
app.provide(IconResolverKey, (name) => getIcon(name as IconName)?.component);
app.mount('#app');
