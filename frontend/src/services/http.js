// 唯一的 axios 实例：统一信封解包、鉴权头、401 处理、错误归一化。
import axios from 'axios';

let tokenGetter = () => '';
let onUnauthorized = () => {};
export const bindAuth = (getToken, on401) => { tokenGetter = getToken; onUnauthorized = on401; };

export class ApiError extends Error {
  constructor(message, { status = 0, code = 0, fields = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields; // 字段级校验错误 {field: message}
  }
  get notConfigured() { return this.code === 40002; }
}

export const http = axios.create({ baseURL: '/api', timeout: 120000 });

http.interceptors.request.use((cfg) => {
  const t = tokenGetter();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

const toError = async (err) => {
  const res = err.response;
  if (!res) return new ApiError(err.code === 'ECONNABORTED' ? '请求超时，请稍后重试' : '网络异常，无法连接服务器');
  let body = res.data;
  if (body instanceof Blob) { // blob 请求失败时错误体也是 Blob
    try { body = JSON.parse(await body.text()); } catch { body = null; }
  }
  if (res.status === 401 && tokenGetter()) onUnauthorized();
  return new ApiError(body?.message || `请求失败 (HTTP ${res.status})`, { status: res.status, code: body?.code, fields: body?.data?.fields || null });
};

http.interceptors.response.use(
  (res) => (res.config.responseType === 'blob' ? res : res.data?.data),
  async (err) => { throw await toError(err); },
);

/** 下载 blob，并解析文件名（优先 filename*）。 */
export async function blob(url, params) {
  const res = await http.get(url, { params, responseType: 'blob' });
  const cd = res.headers['content-disposition'] || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  return { blob: res.data, filename: m ? decodeURIComponent(m[1]) : 'download.xlsx' };
}
