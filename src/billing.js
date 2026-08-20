import { ErrGeneral, SeaArtError, newHTTPError } from './errors.js';

const pathBilling = '/api/v1/cost/billing';

export class BillingService {
  constructor(client) {
    this.client = client;
  }

  async query(params = {}, ...options) {
    const values = new URLSearchParams();
    const source = params ?? {};
    for (const key of ['start', 'end', 'environment', 'provider', 'credential_name', 'model_group']) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '') values.set(key, String(source[key]));
    }
    for (const key of ['page', 'page_size']) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== 0 && source[key] !== '') values.set(key, String(source[key]));
    }
    const suffix = values.toString() ? `?${values.toString()}` : '';
    const { headers, signal } = splitOptions(options);
    const response = await this.client.request('GET', pathBilling + suffix, undefined, headers, { signal });
    const payload = decodeJSON(response.body);
    if (response.status >= 400) throw billingHTTPError(response.status, payload);
    if (payload.code !== undefined && payload.code !== 0) {
      throw new SeaArtError({ kind: ErrGeneral, status: response.status, code: payload.code, message: payload.message || 'billing query failed' });
    }
    return payload.data ?? {};
  }

  async get(params = {}, ...options) {
    return this.query(params, ...options);
  }
}

function billingHTTPError(status, payload) {
  const error = newHTTPError(status, payload?.message || 'billing query failed');
  error.code = payload?.code;
  return error;
}

function splitOptions(options) {
  const headers = {};
  let signal;
  for (const option of options) {
    if (!option) continue;
    if (option.signal) signal = option.signal;
    const source = option.headers ?? option;
    for (const [key, value] of Object.entries(source)) {
      if (key === 'signal' || value === undefined || value === null) continue;
      headers[key] = Array.isArray(value) ? value.map(String) : String(value);
    }
  }
  return { headers, signal };
}

function decodeJSON(payload) {
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new SeaArtError({ kind: ErrGeneral, message: `failed to decode billing response: ${error.message}` });
  }
}
