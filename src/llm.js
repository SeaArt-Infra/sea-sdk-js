import { ErrGeneral, ErrNetwork, SeaArtError, newHTTPError } from './errors.js';
import { buildRequestOptions, keepModelInBody } from './options.js';

const pathChatCompletions = '/chat/completions';
const pathMessages = '/v1/messages';
const pathResponses = '/responses';
const pathRerank = '/rerank';
const pathEmbeddings = '/v1/embeddings';
const pathModels = '/v1/models';

export class LLMService {
  constructor(client) {
    this.client = client;
  }

  async chatCompletions(payload, ...options) {
    if (isStreaming(payload)) {
      throw unsupportedStreamingError('ChatCompletions', 'ChatCompletionsStream');
    }
    return doRawJSON(this.client, 'POST', pathChatCompletions, payload, options);
  }

  chatCompletionsStream(payload, ...options) {
    return doSSE(this.client, 'POST', pathChatCompletions, ensureStreamingPayload(payload), options);
  }

  async messages(payload, ...options) {
    if (isStreaming(payload)) {
      throw unsupportedStreamingError('Messages', 'MessagesStream');
    }
    return doRawJSON(this.client, 'POST', pathMessages, payload, options);
  }

  messagesStream(payload, ...options) {
    return doSSE(this.client, 'POST', pathMessages, ensureStreamingPayload(payload), options);
  }

  async responses(payload, ...options) {
    if (isStreaming(payload)) {
      throw unsupportedStreamingError('Responses', 'ResponsesStream');
    }
    return doRawJSON(this.client, 'POST', pathResponses, payload, options);
  }

  responsesStream(payload, ...options) {
    return doSSE(this.client, 'POST', pathResponses, ensureStreamingPayload(payload), options);
  }

  rerank(payload, ...options) {
    return doRawJSON(this.client, 'POST', pathRerank, payload, options);
  }

  embeddings(payload, ...options) {
    return doRawJSON(this.client, 'POST', pathEmbeddings, payload, options);
  }

  listModels(...options) {
    return doRawJSON(this.client, 'GET', pathModels, undefined, options);
  }
}

export function decode(raw) {
  try {
    if (typeof raw === 'string') {
      return JSON.parse(raw);
    }
    if (raw instanceof Uint8Array) {
      return JSON.parse(new TextDecoder().decode(raw));
    }
    return raw;
  } catch (error) {
    throw new SeaArtError({ kind: ErrGeneral, message: `failed to decode response: ${error.message}` });
  }
}

export function textDeltaFromMessagesChunk(chunk) {
  return chunk?.delta?.type === 'text_delta' ? chunk.delta.text ?? '' : '';
}

export function thinkingDeltaFromMessagesChunk(chunk) {
  return chunk?.delta?.type === 'thinking_delta' ? chunk.delta.thinking ?? '' : '';
}

export function inputJSONDeltaFromMessagesChunk(chunk) {
  return chunk?.delta?.type === 'input_json_delta' ? chunk.delta.partial_json ?? '' : '';
}

export class MessagesStreamTextAssembler {
  constructor() {
    this.buffer = '';
  }

  add(chunk) {
    this.buffer += textDeltaFromMessagesChunk(chunk);
  }

  Add(chunk) {
    this.add(chunk);
  }

  text() {
    return this.buffer;
  }

  Text() {
    return this.text();
  }
}

export function textDeltaFromResponsesChunk(chunk) {
  return chunk?.type === 'response.output_text.delta' ? chunk.delta ?? '' : '';
}

export function outputTextFromResponsesChunk(chunk) {
  if (!chunk) {
    return '';
  }
  if (chunk.type === 'response.output_text.done') {
    return chunk.text ?? '';
  }
  if ((chunk.type === 'response.content_part.added' || chunk.type === 'response.content_part.done') && chunk.part?.type === 'output_text') {
    return chunk.part.text ?? '';
  }
  return '';
}

export class ResponsesStreamTextAssembler {
  constructor() {
    this.buffer = '';
  }

  add(chunk) {
    this.buffer += textDeltaFromResponsesChunk(chunk);
  }

  Add(chunk) {
    this.add(chunk);
  }

  text() {
    return this.buffer;
  }

  Text() {
    return this.text();
  }
}

async function doRawJSON(client, method, path, body, options = []) {
  const { headers, signal } = splitOptions(options);
  const request = body === undefined
    ? { body, headers: keepModelInBody({}, headers).headers }
    : keepModelInBody(body, headers);
  const response = await client.request(method, path, request.body, request.headers, { signal });
  if (response.status >= 400) {
    throw llmHTTPError(response.status, response.body);
  }
  return response.body;
}

async function* doSSE(client, method, path, body, options = []) {
  const { headers, signal } = splitOptions(options);
  const request = keepModelInBody(body, headers);
  const response = await client.requestStream(method, path, request.body, request.headers, { signal });
  if (response.status >= 400) {
    const payload = await response.text();
    throw llmHTTPError(response.status, payload);
  }
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let dataLines = [];

  const emit = function* () {
    if (dataLines.length === 0 && eventName === '') {
      return;
    }
    const data = dataLines.join('\n');
    const event = { event: eventName, Event: eventName, data: undefined, Data: undefined, done: false, Done: false };
    if (data === '[DONE]') {
      event.done = true;
      event.Done = true;
    } else if (data !== '') {
      event.data = data;
      event.Data = data;
    }
    eventName = '';
    dataLines = [];
    if (event.done || event.data !== undefined || event.event) {
      yield event;
    }
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
          continue;
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
  } catch (error) {
    if (error instanceof SeaArtError) {
      throw error;
    }
    throw new SeaArtError({ kind: ErrNetwork, message: `stream read failed: ${error.message}` });
  } finally {
    reader.releaseLock();
  }
}

function ensureStreamingPayload(payload = {}) {
  return { ...payload, stream: true };
}

function isStreaming(payload = {}) {
  return payload.stream === true;
}

function unsupportedStreamingError(methodName, streamMethod) {
  return new SeaArtError({
    kind: ErrGeneral,
    message: `stream=true is not supported by ${methodName}; use ${streamMethod} instead`,
  });
}

function splitOptions(options) {
  const requestOptions = buildRequestOptions(options);
  const signalOption = options.find((option) => option?.signal);
  return { headers: requestOptions.headers, signal: signalOption?.signal };
}

function llmHTTPError(status, payload) {
  let message = httpStatusText(status) || 'HTTP error';
  try {
    const body = JSON.parse(payload);
    if (body?.error?.error_message) {
      message = body.error.error_message;
    } else if (body?.error?.message) {
      message = body.error.message;
    } else if (body?.message) {
      message = body.message;
    }
  } catch {
    // Keep status text.
  }
  return newHTTPError(status, message);
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
