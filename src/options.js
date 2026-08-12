import { ErrGeneral, SeaArtError } from './errors.js';

export function withHeader(key, value) {
  return { headers: { [key]: value } };
}

export function withHeaders(headers) {
  return { headers: headers ?? {} };
}

export function buildRequestOptions(options = []) {
  const headers = {};
  for (const option of options) {
    if (!option) {
      continue;
    }
    const source = option.headers ?? option;
    for (const [key, value] of headerEntries(source)) {
      if (value === undefined || value === null) {
        continue;
      }
      headers[key] = Array.isArray(value) ? value.map(String) : String(value);
    }
  }
  return { headers };
}

export function moveModelToHeader(body, headers = {}) {
  const requestBody = { ...body };
  const requestHeaders = { ...headers };

  if (!Object.hasOwn(requestBody, 'model')) {
    return { body: requestBody, headers: requestHeaders };
  }

  const { model } = requestBody;
  delete requestBody.model;
  if (typeof model !== 'string' || model.trim() === '') {
    throw new SeaArtError({ kind: ErrGeneral, message: 'model must be a non-empty string' });
  }
  if (Object.keys(requestHeaders).some((key) => key.toLowerCase() === 'x-model')) {
    throw new SeaArtError({ kind: ErrGeneral, message: 'model and X-Model cannot both be set' });
  }

  requestHeaders['X-Model'] = model;
  return { body: requestBody, headers: requestHeaders };
}

function headerEntries(source) {
  if (source instanceof Headers) {
    return Array.from(source.entries());
  }
  return Object.entries(source).filter(([key]) => !['signal', 'interval', 'timeout', 'onUpdate'].includes(key));
}

export function withPollInterval(interval) {
  return { interval: durationToMilliseconds(interval, 'interval') };
}

export function withPollTimeout(timeout) {
  return { timeout: durationToMilliseconds(timeout, 'timeout') };
}

export function withPollCallback(onUpdate) {
  return { onUpdate };
}

export function applyPollOptions(options = []) {
  const config = {
    interval: 3000,
    timeout: 5 * 60 * 1000,
    onUpdate: undefined,
  };

  for (const option of options) {
    if (!option) {
      continue;
    }
    if (option.interval !== undefined) {
      config.interval = durationToMilliseconds(option.interval, 'interval');
    }
    if (option.timeout !== undefined) {
      config.timeout = durationToMilliseconds(option.timeout, 'timeout');
    }
    if (option.onUpdate !== undefined) {
      config.onUpdate = option.onUpdate;
    }
  }

  return config;
}

export function durationToMilliseconds(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive number of milliseconds`);
  }
  return value;
}
