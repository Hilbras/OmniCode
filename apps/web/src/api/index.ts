// apps/web src/api — thin barrel. The api client + transport now live in
// @hilbras/app-core; this module exposes the apps/web-composed singleton
// (see ./bootstrap) so existing `import { getOmnicodeWebApi } from '../api'` sites
// keep working unchanged.
export { api, getOmnicodeWebApi } from './bootstrap';
