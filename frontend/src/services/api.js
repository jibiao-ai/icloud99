// 所有后端接口的唯一出口（铁律7）：页面不得直接 fetch/axios。
import { http, blob } from './http';

export { bindAuth, ApiError } from './http';

export const authApi = {
  login: (username, password) => http.post('/auth/login', { username, password }),
  me: () => http.get('/auth/me'),
  portalInfo: () => http.get('/public/portal-info'),
  changePassword: (body) => http.post('/settings/password', body),
};

export const channelApi = {
  list: (range = 7) => http.get('/channels', { params: { range } }),
  detail: (id) => http.get(`/channels/${id}/detail`),
  testStatus: () => http.get('/channels/test/status'),
  testStart: (body = {}) => http.post('/channels/test/start', body),
  testStop: () => http.post('/channels/test/stop'),
  seed: () => http.post('/channels/seed'),
  cleanup: () => http.post('/channels/cleanup'),
};

export const iqApi = {
  list: (params) => http.get('/iq/tests', { params }),
  stats: () => http.get('/iq/stats'),
  schedule: () => http.get('/iq/schedule'),
  run: (tier) => http.post('/iq/run', { tier }),
};

export const tokenApi = {
  query: (key) => http.post('/token-usage/query', { key }),
};

export const usageApi = {
  summary: (params) => http.get('/usage/summary', { params }),
  user: (name, params) => http.get(`/usage/user/${encodeURIComponent(name)}`, { params }),
  userLogs: (name, params) => http.get(`/usage/user/${encodeURIComponent(name)}/logs`, { params }),
  exportXlsx: (params) => blob('/usage/export', params),
};

export const settingsApi = {
  get: () => http.get('/settings'),
  save: (body) => http.put('/settings', body),
  keys: () => http.get('/settings/channel-keys'),
  saveKeys: (items) => http.put('/settings/channel-keys', { items }),
  deleteKey: (provider, tier) => http.delete(`/settings/channel-keys/${provider}/${tier}`),
  newapi: () => http.get('/settings/newapi'),
  saveNewapi: (body) => http.put('/settings/newapi', body),
  testNewapi: () => http.post('/settings/newapi/test'),
  audit: (params) => http.get('/audit-logs', { params }),
};
