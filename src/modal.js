import { ErrGeneral, ErrNetwork, ErrTaskFailed, ErrTimeout, SeaArtError, newHTTPError, withTaskID } from './errors.js';
import { applyPollOptions, buildRequestOptions, moveModelToHeader } from './options.js';

const pathGeneration = '/v1/generation';
const pathGenerationSync = '/v1/generation/sync';
const acceptJSON = 'application/json';
const acceptEventStream = 'text/event-stream';
const syncTimeoutCode = 'SYNC_TIMEOUT';
const pathPrecharge = '/v1/generation/precharge';
const pathTask = '/v1/generation/task/';
const pathModelSkillSearch = '/v1/models/skill/search';
const pathModelSkill = '/v1/models/skill/';
const pathTemplateSpecs = '/v1/template/specs';
const pathImageScan = '/v1/image/scan';
const pathTextScan = '/v1/text/scan';
const pathTextContentScan = '/v1/text/content/scan';
const pathCharacterQualityScan = '/v1/char/quality/scan';
const pathFaceScan = '/v1/face/scan';
const pathAudioScan = '/v1/audio/scan';
const pathVisualStructuredTextFusionScan = '/v1/visual/structured/text/fusion/scan';
const pollNetworkRetryLimit = 3;
const characterQualityScanFields = new Set([
  'name', 'Name',
  'first_msg', 'firstMsg', 'FirstMsg',
  'description', 'Description',
  'scenario', 'Scenario',
  'example_dialogue', 'exampleDialogue', 'ExampleDialogue',
  'opening_line', 'openingLine', 'OpeningLine',
  'character_introduction', 'characterIntroduction', 'CharacterIntroduction',
  'scenario_setting', 'scenarioSetting', 'ScenarioSetting',
  'dialogue_examples', 'dialogueExamples', 'DialogueExamples',
  'personality_setting', 'personalitySetting', 'PersonalitySetting',
]);
const characterQualityScanLineAFields = ['name', 'first_msg', 'description', 'scenario', 'example_dialogue'];
const characterQualityScanLineBFields = ['name', 'opening_line', 'character_introduction', 'scenario_setting', 'dialogue_examples'];
const characterQualityScanLineBOnlyFields = ['opening_line', 'character_introduction', 'scenario_setting', 'dialogue_examples', 'personality_setting'];

export class ModalService {
  constructor(client) {
    this.client = client;
  }

  async create(body, ...options) {
    const { headers, signal } = splitOptions(options);
    const request = moveModelToHeader(body, headers);
    const response = await this.client.request('POST', pathGeneration, request.body, request.headers, { signal });
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
      error: normalizeTaskError(data.error),
      client: this.client,
    });
  }

  async precharge(body, ...options) {
    const { headers, signal } = splitOptions(options);
    const request = moveModelToHeader(body, headers);
    const response = await this.client.request('POST', pathPrecharge, request.body, request.headers, { signal });
    if (response.status >= 400) {
      throw modalHTTPError(response.status, response.body);
    }
    return decodeJSON(response.body);
  }

  async createComfyUITask({ templateId, inputs, highMemory } = {}, ...options) {
    const normalizedTemplateID = String(templateId ?? '').trim();
    if (!normalizedTemplateID) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'templateId is required' });
    }
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'inputs is required' });
    }
    const normalizedInputs = inputs.map((input) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new SeaArtError({ kind: ErrGeneral, message: 'inputs must contain object values' });
      }
      const field = String(input.field ?? '').trim();
      if (!field) {
        throw new SeaArtError({ kind: ErrGeneral, message: 'each ComfyUI input requires field' });
      }
      if (!Object.prototype.hasOwnProperty.call(input, 'value')) {
        throw new SeaArtError({ kind: ErrGeneral, message: 'each ComfyUI input requires value' });
      }
      return { ...input, field };
    });
    const params = {
      template_id: normalizedTemplateID,
      inputs: normalizedInputs,
      ...(highMemory === undefined ? {} : { high_memory: highMemory }),
    };
    return this.create({ model: 'comfyui', input: [{ params }] }, ...options);
  }

  async listComfyUITemplates(templateIds, ...options) {
    const { headers, signal } = splitOptions(options);
    const body = { type: 'comfyui' };
    if (templateIds !== undefined && templateIds !== null) {
      if (!Array.isArray(templateIds)) {
        throw new SeaArtError({ kind: ErrGeneral, message: 'templateIds must be an array' });
      }
      body.template_ids = templateIds;
    }
    const response = await this.client.request('POST', pathTemplateSpecs, body, headers, { signal });
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

  /**
   * Submit a task and block until it reaches a terminal state.
   *
   * One call instead of create + wait: the caller passes the same body as create
   * and never picks a route or a response format. A failed task throws a
   * SeaArtError with kind task_failed, like wait.
   *
   * Do not use this for tasks that may run longer than ~120 seconds: the wait is
   * silent, so a proxy or load balancer can drop the connection at its idle
   * timeout. Use create + wait for those tasks, or createStream when progress is
   * wanted. If the gateway gives up waiting, the thrown error has kind timeout
   * and taskID set, so the task can be resumed instead of resubmitted.
   */
  async createSync(body, ...options) {
    const { headers, signal } = splitOptions(options);
    const request = moveModelToHeader(body, withDefaultHeader(headers, 'Accept', acceptJSON));
    const response = await this.client.request('POST', pathGenerationSync, request.body, request.headers, { signal });
    if (response.status >= 400) {
      throw syncDeliveryError(response.status, response.body);
    }

    const task = newTaskFromResponse(this.client, decodeJSON(response.body));
    if (String(task.status ?? '').toLowerCase() === 'failed') {
      throw taskFailedError(task);
    }
    return task;
  }

  /**
   * Submit a task and stream its output as it is produced.
   *
   * Yields TaskStreamEvent: output frames carry the chunks that arrived (one
   * frame may carry several), the terminal done frame carries the complete
   * result, and error frames report a delivery failure or timeout. Stop on
   * event.done - never on the status of a chunk frame, which is always
   * in_progress.
   */
  async *createStream(body, ...options) {
    const { headers, signal } = splitOptions(options);
    const request = moveModelToHeader(body, withDefaultHeader(headers, 'Accept', acceptEventStream));
    yield* streamTaskEvents(this.client, 'POST', pathGenerationSync, request.body, request.headers, signal);
  }

  /**
   * Stream an existing task's incremental output, starting after cursor.
   *
   * Works for running tasks, finished tasks (chunks replay from cursor) and
   * tasks created elsewhere, which makes a dropped stream resumable without
   * resubmitting the work.
   */
  async *subscribe(taskID, cursor = 0, ...options) {
    const id = String(taskID ?? '').trim();
    if (!id) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'task_id is required' });
    }
    const { headers, signal } = splitOptions(options);
    yield* streamTaskEvents(this.client, 'GET', taskStreamPath(id, cursor), undefined, withDefaultHeader(headers, 'Accept', acceptEventStream), signal);
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
    if (body.uri && body.img_base64) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'uri and img_base64 are mutually exclusive' });
    }
    if (isTruthy(body.is_video) && body.img_base64) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'video scans require uri and do not support img_base64' });
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
    return splitExtra(decodeJSON(response.body), ['ok', 'req_id', 'level', 'label', 'reason', 'usage']);
  }

  async scanCharacterQuality(request, ...options) {
    const body = normalizeCharacterQualityScanRequest(request);
    const { headers, signal } = splitOptions(options);
    const response = await this.client.request('POST', pathCharacterQualityScan, body, headers, { signal });
    if (response.status >= 400) {
      throw modalHTTPError(response.status, response.body);
    }
    return splitExtra(decodeJSON(response.body), ['ok', 'level', 'safety_tag', 'usage']);
  }

  async scanVisualStructuredTextFusion(request, ...options) {
    const body = normalizeVisualStructuredTextFusionScanRequest(request);
    if (!body.text_dict || typeof body.text_dict !== 'object' || Array.isArray(body.text_dict) || Object.keys(body.text_dict).length === 0) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'text_dict is required' });
    }
    if (!body.uri && !body.img_base64) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'uri or img_base64 is required' });
    }
    const { headers, signal } = splitOptions(options);
    const response = await this.client.request('POST', pathVisualStructuredTextFusionScan, body, headers, { signal });
    if (response.status >= 400) {
      throw modalHTTPError(response.status, response.body);
    }
    return splitExtra(decodeJSON(response.body), [
      'ok',
      'nsfw_level',
      'reason',
      'img_reason',
      'text_reason',
      'issue_source',
      'risk_keys',
      'req_id',
      'msg',
      'usage',
    ]);
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
    is_video: request.is_video ?? request.isVideo ?? request.IsVideo,
    callback_url: request.callback_url ?? request.callbackUrl ?? request.CallbackURL,
    callback_context: request.callback_context ?? request.callbackContext ?? request.CallbackContext,
    risk_types: request.risk_types ?? request.riskTypes ?? request.RiskTypes,
    detected_age: request.detected_age ?? request.detectedAge ?? request.DetectedAge,
    canary: request.canary ?? request.Canary,
    scene: request.scene ?? request.Scene,
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

function normalizeCharacterQualityScanRequest(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new SeaArtError({ kind: ErrGeneral, message: 'character quality scan request must be an object' });
  }
  const unknownField = Object.keys(request).find((key) => !characterQualityScanFields.has(key));
  if (unknownField) {
    throw new SeaArtError({ kind: ErrGeneral, message: `unsupported character quality scan field: ${unknownField}` });
  }
  const fields = {
    name: request.name ?? request.Name,
    first_msg: request.first_msg ?? request.firstMsg ?? request.FirstMsg,
    description: request.description ?? request.Description,
    scenario: request.scenario ?? request.Scenario,
    example_dialogue: request.example_dialogue ?? request.exampleDialogue ?? request.ExampleDialogue,
    opening_line: request.opening_line ?? request.openingLine ?? request.OpeningLine,
    character_introduction: request.character_introduction ?? request.characterIntroduction ?? request.CharacterIntroduction,
    scenario_setting: request.scenario_setting ?? request.scenarioSetting ?? request.ScenarioSetting,
    dialogue_examples: request.dialogue_examples ?? request.dialogueExamples ?? request.DialogueExamples,
    personality_setting: request.personality_setting ?? request.personalitySetting ?? request.PersonalitySetting,
  };
  const body = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== 'string' || !value.trim()) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'character quality scan fields must be non-empty strings' });
    }
    body[key] = value;
  }

  const hasLineAField = characterQualityScanLineAFields.some((key) => key !== 'name' && body[key] !== undefined);
  const hasLineBField = characterQualityScanLineBOnlyFields.some((key) => body[key] !== undefined);
  if (hasLineAField && hasLineBField) {
    throw new SeaArtError({ kind: ErrGeneral, message: 'character quality scan request must use either production-line A or B fields' });
  }
  const requiredFields = hasLineAField ? characterQualityScanLineAFields : hasLineBField ? characterQualityScanLineBFields : undefined;
  if (!requiredFields) {
    throw new SeaArtError({ kind: ErrGeneral, message: 'character quality scan request must include a complete production-line A or B field set' });
  }
  const missingFields = requiredFields.filter((key) => body[key] === undefined);
  if (missingFields.length > 0) {
    throw new SeaArtError({ kind: ErrGeneral, message: `character quality scan request is missing required fields: ${missingFields.join(', ')}` });
  }
  return body;
}

function normalizeVisualStructuredTextFusionScanRequest(request = {}) {
  return omitUndefined({
    ...request,
    text_dict: request.text_dict ?? request.textDict ?? request.TextDict,
    img_base64: trimOptionalString(request.img_base64 ?? request.imgBase64 ?? request.ImgBase64),
    uri: trimOptionalString(request.uri ?? request.URI),
    business_type: request.business_type ?? request.businessType ?? request.BusinessType,
    detected_age: request.detected_age ?? request.detectedAge ?? request.DetectedAge,
    hash_comparison: request.hash_comparison ?? request.hashComparison ?? request.HashComparison,
    canary: request.canary ?? request.Canary,
    mode: request.mode ?? request.Mode,
    ocr: request.ocr ?? request.OCR ?? request.Ocr,
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

function isTruthy(value) {
  return value === true || value === 1;
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
  delete output.CallbackURL;
  delete output.callbackUrl;
  delete output.CallbackContext;
  delete output.callbackContext;
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
  delete output.TextDict;
  delete output.textDict;
  delete output.ImgBase64;
  delete output.imgBase64;
  delete output.URI;
  delete output.BusinessType;
  delete output.businessType;
  delete output.DetectedAge;
  delete output.detectedAge;
  delete output.HashComparison;
  delete output.hashComparison;
  delete output.Canary;
  delete output.Mode;
  delete output.OCR;
  delete output.Ocr;
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

  /** Subscribe to this task's incremental output, starting after cursor. */
  async *stream(cursor = 0, ...options) {
    if (!this.client) {
      throw new SeaArtError({ kind: ErrGeneral, message: 'task is detached from client' });
    }
    const { headers, signal } = splitOptions(options);
    yield* streamTaskEvents(this.client, 'GET', taskStreamPath(this.id, cursor), undefined, withDefaultHeader(headers, 'Accept', acceptEventStream), signal);
  }

  async *Stream(cursor = 0, ...options) {
    yield* this.stream(cursor, ...options);
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
    error: normalizeTaskError(data.error),
    client,
  });
}

function normalizeTaskError(error) {
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return undefined;
  }
  return omitUndefined({
    code: error.code,
    error_message: error.error_message,
    message: error.message,
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
      const detail = task.error?.error_message ?? task.error?.message;
      const suffix = detail ? `: ${detail}` : '';
      throw new SeaArtError({ kind: ErrTaskFailed, message: `task failed${suffix}`, taskID, code: task.error?.code });
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
    } else if (body?.error?.message) {
      message = body.error.message;
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

/**
 * One event of a streamed generation delivery.
 *
 * event is 'output' (event.chunks holds the new chunks, event.cursor is the
 * resume cursor), 'done' (event.task holds the complete result) or 'error'
 * (event.errorCode / event.errorMessage describe the failure).
 *
 * Judge the end of the stream by event.done: it is true for both 'done' and
 * 'error'. Chunk frames always report status 'in_progress', so stopping on a
 * task status would drop the terminal event and lose the result.
 */
export class TaskStreamEvent {
  constructor({ event = '', taskID = '', status = '', cursor = 0, chunks, task = null, errorCode = '', errorMessage = '', done = false, error = null } = {}) {
    this.event = event;
    this.Event = event;
    this.status = status;
    this.Status = status;
    this.taskID = taskID;
    this.TaskID = taskID;
    this.cursor = cursor;
    this.Cursor = cursor;
    this.chunks = chunks ?? [];
    this.Chunks = this.chunks;
    this.task = task;
    this.Task = task;
    this.errorCode = errorCode;
    this.ErrorCode = errorCode;
    this.errorMessage = errorMessage;
    this.ErrorMessage = errorMessage;
    this.done = done;
    this.Done = done;
    this.error = error;
    this.Error = error;
  }

  /** URLs of the chunks carried by this event (empty for done/error frames). */
  urls() {
    const urls = [];
    for (const item of this.chunks) {
      for (const content of item?.content ?? []) {
        if (content?.url) {
          urls.push(content.url);
        }
      }
    }
    return urls;
  }

  Urls() {
    return this.urls();
  }
}

function taskStreamPath(taskID, cursor) {
  const value = normalizeCursor(cursor);
  const suffix = value > 0 ? `?cursor=${value}` : '';
  return `${pathTask}${encodeURIComponent(String(taskID).trim())}/stream${suffix}`;
}

/**
 * Validate a resume cursor.
 *
 * A bad cursor must never be silently dropped: omitting it makes the gateway replay
 * from the beginning, which duplicates output the caller already consumed.
 */
function normalizeCursor(cursor) {
  if (cursor === undefined || cursor === null) {
    return 0;
  }
  let value = Number.NaN;
  if (typeof cursor === 'number') {
    value = cursor;
  } else if (typeof cursor === 'string' && /^[0-9]+$/.test(cursor.trim()) && cursor.trim() !== '') {
    value = Number(cursor.trim());
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new SeaArtError({
      kind: ErrGeneral,
      message: `cursor must be a non-negative integer, got ${JSON.stringify(cursor)}`,
    });
  }
  return value;
}

function taskFailedError(task) {
  const detail = task.error?.error_message ?? task.error?.message;
  const suffix = detail ? `: ${detail}` : '';
  return new SeaArtError({ kind: ErrTaskFailed, message: `task failed${suffix}`, taskID: task.id, code: task.error?.code });
}

/**
 * Turn a failed synchronous delivery into an SDK error.
 *
 * Starts from the generic HTTP error so the status keeps driving the kind
 * (429 -> quota, 504 -> timeout), then keeps what only this endpoint knows: the
 * gateway error code and the task id that callers need to resume the task.
 */
function syncDeliveryError(status, payload) {
  const error = modalHTTPError(status, payload);
  let code = '';
  let taskID = '';
  try {
    const body = JSON.parse(payload);
    if (typeof body?.id === 'string') {
      taskID = body.id;
    }
    const rawCode = body?.error?.code;
    if (rawCode !== undefined && rawCode !== null && String(rawCode) !== '') {
      code = String(rawCode);
    }
  } catch {
    // Keep the status-derived error.
  }
  if (code === syncTimeoutCode) {
    error.kind = ErrTimeout;
    error.Kind = ErrTimeout;
  }
  if (code) {
    error.code = code;
    error.Code = code;
  }
  if (taskID) {
    withTaskID(error, taskID);
  }
  return error;
}

/** Parse one gateway SSE frame into a TaskStreamEvent. */
function parseTaskStreamEvent(eventName, data) {
  const name = eventName || 'output';
  let payload;
  try {
    payload = JSON.parse(data);
  } catch (error) {
    // Surface a malformed frame instead of turning it into an empty event that
    // hides the failure reason.
    return new TaskStreamEvent({
      event: name,
      error: new SeaArtError({ kind: ErrGeneral, message: `failed to decode stream frame: ${error.message}` }),
    });
  }

  const status = payload?.status !== undefined && payload?.status !== null ? String(payload.status) : '';

  if (name === 'done') {
    const task = newTaskFromResponse(null, payload);
    return new TaskStreamEvent({ event: 'done', taskID: payload?.id ?? '', status, task, done: true });
  }
  if (name === 'error') {
    return new TaskStreamEvent({
      event: 'error',
      taskID: payload?.id ?? '',
      status,
      errorCode: payload?.error?.code !== undefined && payload?.error?.code !== null ? String(payload.error.code) : '',
      // The gateway uses message on this endpoint, but error_message also appears
      // on gateway error payloads; keep whichever is present so the failure reason
      // is never dropped.
      errorMessage: firstNonEmpty(payload?.error?.message, payload?.error?.error_message),
      done: true,
    });
  }
  return new TaskStreamEvent({
    event: 'output',
    taskID: payload?.id ?? '',
    status,
    cursor: typeof payload?.cursor === 'number' ? payload.cursor : 0,
    chunks: payload?.output ?? [],
  });
}

/** First value that is present and non-empty, as a string. */
function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value) !== '') {
      return String(value);
    }
  }
  return '';
}

/** Read the gateway's generation SSE stream and yield task events. */
async function* streamTaskEvents(client, method, path, body, headers, signal) {
  const response = await client.requestStream(method, path, body, headers, { signal });
  if (response.status >= 400) {
    const payload = await response.text();
    throw syncDeliveryError(response.status, payload);
  }
  if (!response.body) {
    throw streamEndedEarlyError();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let dataLines = [];
  let sawTerminal = false;

  const emit = function* () {
    if (dataLines.length === 0 && eventName === '') {
      return;
    }
    const data = dataLines.join('\n');
    const name = eventName;
    eventName = '';
    dataLines = [];
    if (data === '' || data === '[DONE]') {
      sawTerminal = true;
      yield new TaskStreamEvent({ event: 'done', done: true });
      return;
    }
    const event = parseTaskStreamEvent(name, data);
    if (event.done) {
      sawTerminal = true;
    }
    yield event;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.search(/\r?\n/)) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + (buffer[newline] === '\r' && buffer[newline + 1] === '\n' ? 2 : 1));

        if (line === '') {
          yield* emit();
          continue;
        }
        if (line.startsWith(':')) {
          continue; // keepalive comment sent while the task runs
        }
        if (line.startsWith('event:')) {
          eventName = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trim());
        }
      }
    }
    buffer += decoder.decode();
    if (buffer !== '') {
      for (const line of buffer.split(/\r?\n/)) {
        if (line.startsWith('event:')) {
          eventName = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trim());
        }
      }
    }
    yield* emit();

    // A stream that ends without a terminal event is a truncated delivery: the
    // caller must not treat the partial result as success.
    if (!sawTerminal) {
      throw streamEndedEarlyError();
    }
  } catch (error) {
    if (error instanceof SeaArtError) {
      throw error;
    }
    throw new SeaArtError({ kind: ErrNetwork, message: `stream read failed: ${error.message}` });
  } finally {
    reader.releaseLock();
  }
}

function streamEndedEarlyError() {
  return new SeaArtError({
    kind: ErrNetwork,
    message: 'stream ended before a terminal event; resume with subscribe(taskID, cursor)',
  });
}
