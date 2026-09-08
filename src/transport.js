import { ErrGeneral, ErrNetwork, SeaArtError } from './errors.js';

export class TransportClient {
  constructor({ apiKey = '', baseURL, project = '', headers = {}, userAgent, timeout = 5 * 60 * 1000, fetch: fetchImpl } = {}) {
    if (!baseURL) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'baseURL is required' });
    }
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.project = project;
    this.defaultHeaders = headers;
    this.userAgent = userAgent;
    this.timeout = timeout;
    this.fetch = fetchImpl ?? globalThis.fetch;
    if (typeof this.fetch !== 'function') {
      throw new SeaArtError({ kind: ErrGeneral, message: 'fetch is not available; use Node.js 18+ or provide config.fetch' });
    }
  }

  async request(method, path, body, headers = {}, options = {}) {
    const response = await this._fetch(method, path, encodeJSONBody(body), headers, options);
    const payload = await response.text();
    return { status: response.status, headers: response.headers, body: payload };
  }

  async requestRaw(method, path, body, headers = {}, options = {}) {
    const response = await this._fetch(method, path, body, headers, options);
    const payload = await response.arrayBuffer();
    return {
      status: response.status,
      headers: response.headers,
      body: new Uint8Array(payload),
    };
  }

  async requestStream(method, path, body, headers = {}, options = {}) {
    return this._fetch(method, path, encodeJSONBody(body), headers, options);
  }

  async _fetch(method, path, body, headers, options) {
    const controller = new AbortController();
    const timeoutID = this.timeout > 0 ? setTimeout(() => controller.abort(), this.timeout) : undefined;
    const signal = mergeAbortSignals(controller.signal, options.signal);

    try {
      return await this.fetch(this.baseURL + path, {
        method,
        headers: this._headers(headers),
        body,
        signal,
      });
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'request failed: timeout' : `request failed: ${error?.message ?? String(error)}`;
      throw new SeaArtError({ kind: ErrNetwork, message });
    } finally {
      if (timeoutID !== undefined) {
        clearTimeout(timeoutID);
      }
    }
  }

  _headers(extraHeaders = {}) {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${this.apiKey}`);
    headers.set('User-Agent', this.userAgent);
    if (this.project) {
      headers.set('X-Project', this.project);
    }

    for (const [key, value] of Object.entries(this.defaultHeaders ?? {})) {
      headers.delete(key);
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(key, String(item));
        }
      } else if (value !== undefined && value !== null) {
        headers.set(key, String(value));
      }
    }
    for (const [key, value] of Object.entries(extraHeaders ?? {})) {
      headers.delete(key);
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(key, String(item));
        }
      } else if (value !== undefined && value !== null) {
        headers.set(key, String(value));
      }
    }

    return headers;
  }
}

function encodeJSONBody(body) {
  if (body === undefined || body === null) {
    return undefined;
  }
  try {
    return JSON.stringify(body);
  } catch (error) {
    throw new SeaArtError({ kind: ErrGeneral, message: `failed to marshal request: ${error.message}` });
  }
}

function mergeAbortSignals(primary, secondary) {
  if (!secondary) {
    return primary;
  }
  if (secondary.aborted) {
    return secondary;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  primary.addEventListener('abort', abort, { once: true });
  secondary.addEventListener('abort', abort, { once: true });
  return controller.signal;
}
