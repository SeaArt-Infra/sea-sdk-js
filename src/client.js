import { ErrGeneral, SeaArtError } from './errors.js';
import { TransportClient } from './transport.js';
import { ModalService } from './modal.js';
import { LLMService } from './llm.js';
import { PassthroughService } from './passthrough.js';
import { BillingService } from './billing.js';

export const defaultBaseURL = 'https://gateway.example.com';
export const defaultModelBaseURL = `${defaultBaseURL}/model`;
export const defaultLLMBaseURL = `${defaultBaseURL}/llm`;
export const defaultPassthroughBaseURL = defaultModelBaseURL;
export const defaultBillingBaseURL = `${defaultBaseURL}/monitor`;
export const defaultTimeout = 5 * 60 * 1000;
export const sdkVersion = '0.1.0';

export class Client {
  constructor(config = {}) {
    const endpoints = resolveEndpoints(config);
    const timeout = config.timeout ?? config.Timeout ?? defaultTimeout;

    this.apiKey = config.apiKey ?? config.APIKey ?? '';
    this.baseURL = endpoints.root;
    this.modelBaseURL = endpoints.model;
    this.llmBaseURL = endpoints.llm;
    this.passthroughBaseURL = endpoints.passthrough;
    this.billingBaseURL = endpoints.billing;
    this.project = config.project ?? config.Project ?? '';

    const shared = {
      apiKey: this.apiKey,
      project: this.project,
      timeout,
      fetch: config.fetch,
    };

    this.modal = new ModalService(new TransportClient({
      ...shared,
      baseURL: this.modelBaseURL,
      userAgent: `seaart-sdk-js/${sdkVersion}`,
    }));
    this.llm = new LLMService(new TransportClient({
      ...shared,
      baseURL: this.llmBaseURL,
      userAgent: `seaart-sdk-js/${sdkVersion}`,
    }));
    this.passthrough = new PassthroughService(new TransportClient({
      ...shared,
      baseURL: this.passthroughBaseURL,
      userAgent: `seaart-sdk-js/${sdkVersion}`,
    }));
    this.billing = new BillingService(new TransportClient({
      ...shared,
      baseURL: this.billingBaseURL,
      userAgent: `seaart-sdk-js/${sdkVersion}`,
    }));

    this.Modal = goStyleService(this.modal, {
      create: 'Create',
      createComfyUITask: 'CreateComfyUITask',
      precharge: 'Precharge',
      get: 'Get',
      wait: 'Wait',
      listModels: 'ListModels',
      listComfyUITemplates: 'ListComfyUITemplates',
      searchModels: 'SearchModels',
      getModelSkill: 'GetModelSkill',
      scanImage: 'ScanImage',
      scanText: 'ScanText',
      scanTextContent: 'ScanTextContent',
      scanCharacterQuality: 'ScanCharacterQuality',
      scanFace: 'ScanFace',
      scanAudio: 'ScanAudio',
      scanVisualStructuredTextFusion: 'ScanVisualStructuredTextFusion',
    });
    this.LLM = goStyleService(this.llm, {
      chatCompletions: 'ChatCompletions',
      chatCompletionsStream: 'ChatCompletionsStream',
      messages: 'Messages',
      messagesStream: 'MessagesStream',
      responses: 'Responses',
      responsesStream: 'ResponsesStream',
      rerank: 'Rerank',
      embeddings: 'Embeddings',
      listModels: 'ListModels',
    });
    this.Passthrough = goStyleService(this.passthrough, {
      request: 'Request',
      requestRaw: 'RequestRaw',
      get: 'Get',
      post: 'Post',
      put: 'Put',
      delete: 'Delete',
    });
    this.Billing = goStyleService(this.billing, { query: 'Query', get: 'Get' });
  }
}

export function createClient(config = {}) {
  return new Client(config);
}

export const New = createClient;

export function resolveEndpoints(config = {}) {
  const baseURL = config.baseURL ?? config.BaseURL ?? '';
  const root = resolveRootURL(baseURL);
  const hasBaseURL = baseURL !== '';
  const model = resolveServiceURL(config.modelBaseURL ?? config.ModelBaseURL ?? '', hasBaseURL, root, 'model', defaultModelBaseURL);
  const llm = resolveServiceURL(config.llmBaseURL ?? config.LLMBaseURL ?? '', hasBaseURL, root, 'llm', defaultLLMBaseURL);
  const passthrough = resolvePassthroughURL(config.passthroughBaseURL ?? config.PassthroughBaseURL ?? '', model);
  const billing = resolveServiceURL(config.billingBaseURL ?? config.BillingBaseURL ?? '', hasBaseURL, root, 'monitor', defaultBillingBaseURL);
  return { root, model, llm, passthrough, billing };
}

function resolveRootURL(raw) {
  return normalizeURL(raw || defaultBaseURL);
}

function resolveServiceURL(raw, deriveFromRoot, root, suffix, fallback) {
  if (raw) {
    return normalizeURL(raw);
  }
  if (deriveFromRoot) {
    return joinURL(root, suffix);
  }
  return fallback;
}

function resolvePassthroughURL(raw, model) {
  return raw ? normalizeURL(raw) : model;
}

export function normalizeURL(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new SeaArtError({ kind: ErrGeneral, message: `invalid URL: ${error.message}` });
  }
  if (!parsed.protocol || !parsed.host) {
    throw new SeaArtError({ kind: ErrGeneral, message: 'invalid URL: missing scheme or host' });
  }

  parsed.pathname = cleanURLPath(parsed.pathname);
  if (parsed.pathname === '/') {
    parsed.pathname = '';
  }
  return parsed.toString().replace(/\/$/, '');
}

function joinURL(baseURL, suffix) {
  const parsed = new URL(baseURL);
  parsed.pathname = cleanURLPath(`${parsed.pathname}/${suffix}`);
  return normalizeURL(parsed.toString());
}

function cleanURLPath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const stack = [];
  for (const part of parts) {
    if (part === '.') {
      continue;
    }
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return `/${stack.join('/')}`;
}

function goStyleService(service, names) {
  for (const [jsName, goName] of Object.entries(names)) {
    service[goName] = service[jsName].bind(service);
  }
  return service;
}
