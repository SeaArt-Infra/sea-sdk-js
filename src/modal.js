import { ErrGeneral, ErrNetwork, ErrTaskFailed, ErrTimeout, SeaArtError, newHTTPError, withTaskID } from './errors.js';
import { applyPollOptions, buildRequestOptions } from './options.js';

const pathGeneration = '/v1/generation';
const pathPrecharge = '/v1/generation/precharge';
const pathTask = '/v1/generation/task/';
const pathModelSkillSearch = '/v1/models/skill/search';
const pathModelSkill = '/v1/models/skill/';
const pathImageScan = '/v1/image/scan';
const pathTextScan = '/v1/text/scan';
const pathTextContentScan = '/v1/text/content/scan';
const pathFaceScan = '/v1/face/scan';
const pathAudioScan = '/v1/audio/scan';
const pollNetworkRetryLimit = 3;

export class ModalService {
  constructor(client) {
    this.client = client;
  }

  async create(body, ...options) {
    const { headers, signal } = splitOptions(options);
    const response = await this.client.request('POST', pathGeneration, body, headers, { signal });
    if (response.status >= 400) {
      throw modalHTTPError(response.status, response.body);
    }

    const data = decodeJSON(response.body);
    if (!data.id) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'API returned no task ID' });
    }
    return new Task({
      id: data.id,
      status: data.status,
      model: data.model,
      error: data.error,
      client: this.client,
    });
  }

  async precharge(body, ...options) {
    const { headers, signal } = splitOptions(options);
    const response = await this.client.request('POST', pathPrecharge, body, headers, { signal });
    if (response.status >= 400) {
      throw modalHTTPError(response.status, response.body);
    }
    return decodeJSON(response.body);
  }

  async get(taskID, ...options) {
    const { headers, signal } = splitOptions(options);
    return getTask(this.client, taskID, headers, signal);
  }

  async wait(taskID, ...options) {
    return waitTask(this.client, taskID, options);
  }

  async listModels(params = {}, ...options) {
    const { headers, signal } = splitOptions(options);
    const response = await this.client.request('GET', pathModelSkillSearch + modelSearchQuery(params), undefined, withDefaultHeader(headers, 'Accept', 'application/json'), { signal });
    if (response.status >= 400) {
      throw modalHTTPError(response.status, response.body);
    }
    return decodeJSON(response.body);
  }

  async searchModels(params = {}, ...options) {
    return this.listModels(params, ...options);
  }

  async getModelSkill(model, ...options) {
    const trimmed = String(model ?? '').trim();
    if (!trimmed) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'model is required' });
    }
    const { headers, signal } = splitOptions(options);
    const response = await this.client.request('GET', pathModelSkill + encodeURIComponent(trimmed), undefined, withDefaultHeader(headers, 'Accept', 'application/json'), { signal });
    if (response.status >= 400) {
      throw modalHTTPError(response.status, response.body);
    }
    return response.body;
  }

  async scanImage(request, ...options) {
    const body = normalizeImageScanRequest(request);
    if (!body.uri && !body.img_base64) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'uri or img_base64 is required' });
    }
    const { headers, signal } = splitOptions(options);
    const response = await this.client.request('POST', pathImageScan, body, headers, { signal });
    if (response.status >= 400) {
      throw modalHTTPError(response.status, response.body);
    }
    return decodeJSON(response.body);
  }

  async scanText(request, ...options) {
    const body = normalizeTextScanRequest(request);
    if (!body.text) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'text is required' });
    }
    const { headers, signal } = splitOptions(options);
    const response = await this.client.request('POST', pathTextScan, body, headers, { signal });
    if (response.status >= 400) {
      throw modalHTTPError(response.status, response.body);
    }
    return splitExtra(decodeJSON(response.body), ['data', 'status', 'usage']);
  }

  async scanTextContent(request, ...options) {
    const body = normalizeTextContentScanRequest(request);
    if (!String(body.text ?? '').trim()) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'text is required' });
    }
    const { headers, signal } = splitOptions(options);
    const response = await this.client.request('POST', pathTextContentScan, body, headers, { signal });
    if (response.status >= 400) {
      throw modalHTTPError(response.status, response.body);
    }
    return splitExtra(decodeJSON(response.body), ['ok', 'level', 'label', 'reason', 'usage']);
  }

  async scanFace(request, ...options) {
    const body = normalizeFaceScanRequest(request);
    if (!body.uri && !body.img_base64) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'uri or img_base64 is required' });
    }
    const { headers, signal } = splitOptions(options);
    const response = await this.client.request('POST', pathFaceScan, body, headers, { signal });
    if (response.status >= 400) {
      throw modalHTTPError(response.status, response.body);
    }
    return splitExtra(decodeJSON(response.body), ['ok', 'error', 'usage']);
  }

  async scanAudio(request, ...options) {
    const body = normalizeAudioScanRequest(request);
    if (!body.uri) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'uri is required' });
    }
    const { headers, signal } = splitOptions(options);
    const response = await this.client.request('POST', pathAudioScan, body, headers, { signal });
    if (response.status >= 400) {
      throw modalHTTPError(response.status, response.body);
    }
    return splitExtra(decodeJSON(response.body), ['riskDescription', 'riskLevel', 'allLabels', 'usage']);
  }
}

function normalizeImageScanRequest(request = {}) {
  return omitUndefined({
    ...request,
    uri: trimOptionalString(request.uri ?? request.URI),
    img_base64: trimOptionalString(request.img_base64 ?? request.imgBase64 ?? request.ImgBase64),
    risk_types: request.risk_types ?? request.riskTypes ?? request.RiskTypes,
    detected_age: request.detected_age ?? request.detectedAge ?? request.DetectedAge,
    is_video: request.is_video ?? request.isVideo ?? request.IsVideo,
    duration: request.duration ?? request.Duration,
  });
}

function normalizeTextScanRequest(request = {}) {
  const text = request.text ?? request.Text ?? '';
  return omitUndefined({
    ...request,
    text,
    scene: request.scene ?? request.Scene,
    area_types: request.area_types ?? request.areaTypes ?? request.AreaTypes,
    way: request.way ?? request.Way,
    scenes: request.scenes ?? request.Scenes,
  });
}

function normalizeTextContentScanRequest(request = {}) {
  const text = request.text ?? request.Text ?? '';
  return omitUndefined({
    ...request,
    text,
    canary: request.canary ?? request.Canary,
    scene: request.scene ?? request.Scene,
  });
}

function normalizeFaceScanRequest(request = {}) {
  return omitUndefined({
    ...request,
    uri: trimOptionalString(request.uri ?? request.URI),
    img_base64: trimOptionalString(request.img_base64 ?? request.imgBase64 ?? request.ImgBase64),
    is_video: request.is_video ?? request.isVideo ?? request.IsVideo,
    canary: request.canary ?? request.Canary,
    scene: request.scene ?? request.Scene,
    duration: request.duration ?? request.Duration,
  });
}

function normalizeAudioScanRequest(request = {}) {
  return omitUndefined({
    ...request,
    uri: String(request.uri ?? request.URI ?? '').trim(),
    rec_type: request.rec_type ?? request.recType ?? request.RecType,
    duration: request.duration ?? request.Duration,
  });
}

function trimOptionalString(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || undefined;
}

function omitUndefined(value) {
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      output[key] = item;
    }
  }
  delete output.URI;
  delete output.RiskTypes;
  delete output.DetectedAge;
  delete output.IsVideo;
  delete output.riskTypes;
  delete output.detectedAge;
  delete output.isVideo;
  delete output.Text;
  delete output.Scene;
  delete output.AreaTypes;
  delete output.Way;
  delete output.Scenes;
  delete output.areaTypes;
  delete output.Canary;
  delete output.ImgBase64;
  delete output.imgBase64;
  delete output.Canary;
  delete output.Duration;
  delete output.RecType;
  delete output.recType;
  return output;
}

export class Task {
  constructor({ id, status, model, progress = 0, output, usage, error, client }) {
    this.id = id;
    this.ID = id;
    this.status = status;
    this.Status = status;
    this.model = model;
    this.Model = model;
    this.progress = progress;
    this.Progress = progress;
    this.output = output ?? [];
    this.Output = this.output;
    this.usage = usage;
    this.Usage = usage;
    this.error = error;
    this.Error = error;
    this.client = client;
  }

  async wait(...options) {
    if (!this.client) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'task is detached from client' });
    }
    return waitTask(this.client, this.id, options);
  }

  async Wait(...options) {
    return this.wait(...options);
  }
}

async function getTask(client, taskID, headers = {}, signal) {
  const response = await client.request('GET', pathTask + taskID, undefined, headers, { signal });
  if (response.status >= 400) {
    throw modalHTTPError(response.status, response.body);
  }
  return newTaskFromResponse(client, decodeJSON(response.body));
}

function newTaskFromResponse(client, data) {
  return new Task({
    id: data.id,
    status: data.status,
    model: data.model,
    progress: data.progress ?? 0,
    output: data.output ?? [],
    usage: data.usage,
    error: data.error,
    client,
  });
}

async function waitTask(client, taskID, options = []) {
  const config = applyPollOptions(options);
  const deadline = Date.now() + config.timeout;
  let networkErrors = 0;

  while (Date.now() < deadline) {
    let task;
    try {
      task = await getTask(client, taskID);
    } catch (error) {
      if (error instanceof SeaArtError && error.kind === ErrNetwork && networkErrors < pollNetworkRetryLimit) {
        networkErrors += 1;
        await delay(config.interval);
        continue;
      }
      throw withTaskID(error, taskID);
    }
    networkErrors = 0;

    const status = String(task.status ?? '').toLowerCase();
    if (config.onUpdate) {
      config.onUpdate(status, task.progress);
    }

    if (status === 'completed') {
      return task;
    }
    if (status === 'failed') {
      const suffix = task.error?.error_message ? `: ${task.error.error_message}` : '';
      throw new SeaArtError({ kind: ErrTaskFailed, message: `task failed${suffix}`, taskID });
    }
    await delay(config.interval);
  }

  throw new SeaArtError({ kind: ErrTimeout, message: `task timed out after ${config.timeout}ms`, taskID });
}

function modelSearchQuery(params = {}) {
  const values = new URLSearchParams();
  values.set('q', params.query ?? params.Query ?? '');
  addQuery(values, 'input', params.input ?? params.Input);
  addQuery(values, 'output', params.output ?? params.Output);
  addQuery(values, 'type', params.type ?? params.Type);
  addQuery(values, 'provider', params.provider ?? params.Provider);
  const limit = params.limit ?? params.Limit;
  if (limit > 0) {
    values.set('limit', String(limit));
  }
  return `?${values.toString()}`;
}

function addQuery(values, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    values.set(key, String(value));
  }
}

function withDefaultHeader(headers, key, value) {
  const next = { ...headers };
  if (!hasHeader(next, key)) {
    next[key] = value;
  }
  return next;
}

function hasHeader(headers, key) {
  const lower = key.toLowerCase();
  return Object.keys(headers ?? {}).some((name) => name.toLowerCase() === lower);
}

function splitOptions(options) {
  const requestOptions = buildRequestOptions(options);
  const signalOption = options.find((option) => option?.signal);
  return { headers: requestOptions.headers, signal: signalOption?.signal };
}

function modalHTTPError(status, payload) {
  let message = httpStatusText(status) || 'HTTP error';
  try {
    const body = JSON.parse(payload);
    if (body?.error?.error_message) {
      message = body.error.error_message;
    }
  } catch {
    // Keep status text.
  }
  return newHTTPError(status, message);
}

function decodeJSON(payload) {
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new SeaArtError({ kind: ErrGeneral, message: `failed to decode response: ${error.message}` });
  }
}

function splitExtra(body, knownKeys) {
  const extra = {};
  for (const [key, value] of Object.entries(body)) {
    if (!knownKeys.includes(key)) {
      extra[key] = value;
    }
  }
  return { ...body, extra, Extra: extra };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpStatusText(status) {
  return {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    408: 'Request Timeout',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  }[status];
}
