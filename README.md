# Sea JavaScript SDK

> Beta: SDK APIs and Sea gateway behavior may still change with gateway versions.

Node.js SDK for the Sea AI gateway, used to call multimodal, LLM, and vendor passthrough capabilities through the unified gateway.

Features:

- ESM-only, requires Node.js 18 or later
- Preserves raw request passthrough capabilities
- Supports SSE streaming response parsing
- Supports task polling and a general task builder

## Feature Navigation

| Service | Client Field | Capability |
|------|-------------|------|
| [Multimodal API](#multimodal-api) | `client.modal` / `client.Modal` | Model listing, parameter details, generation tasks, precharge estimates, and vendor passthrough |
| [Image/Video Safety Scan](#imagevideo-safety-scan) | `client.modal.scanImage(...)` | Detect content-safety risks in images, GIFs, or videos |
| [Sensitive-Word Scan](#sensitive-word-scan) | `client.modal.scanText(...)` | Detect sensitive words and combination-rule risks in text |
| [Text Content Safety Scan](#text-content-safety-scan) | `client.modal.scanTextContent(...)` | Review short text risk level and category label |
| [Face Scan](#face-scan) | `client.modal.scanFace(...)` | Detect face-related results in images or videos |
| [Audio Scan](#audio-scan) | `client.modal.scanAudio(...)` | Detect audio content risks |
| [LLM API](#llm-api) | `client.llm` / `client.LLM` | OpenAI / Anthropic / Responses / Embeddings / Rerank compatible APIs |

## Installation

Install the latest code from GitHub:

```bash
npm install https://github.com/SeaArt-Infra/sea_sdk_js.git
```

After it is published to npm, you can also install it by package name:

```bash
npm install sea_sdk_js
```

Requirements:

- Node.js 18+
- ESM project

## Initialization

```js
import { Client } from 'sea_sdk_js';

const client = new Client({
  apiKey: 'sa-your-api-key',
});
```

Configure the unified gateway address through `baseURL`; the SDK uses it to call multimodal, LLM, passthrough, and other capabilities.

```js
const client = new Client({
  apiKey: 'sa-your-api-key',
  baseURL: 'https://gateway.example.com',
  timeout: 60_000,
  project: 'my-project',
});
```

## Multimodal API

### Model List and Parameter Details

```js
const models = await client.modal.listModels({
  query: '',
  limit: 2,
});
for (const hit of models.hits ?? []) {
  console.log(hit.name);
}

const skill = await client.modal.getModelSkill('alibaba_animate_anyone_detect');
console.log(skill);
```

`listModels` / `searchModels` supports these query parameters:

- `query` -> `q`
- `input` -> `input`
- `output` -> `output`
- `type` -> `type`
- `provider` -> `provider`
- `limit` -> `limit`

### Generation Tasks

There are two common ways to create a task: pass the raw request object directly, or use the `newTask` typed helper to build the request body. Both methods eventually call `client.modal.create(...)`.

**Method 1: Pass the raw request object directly**

```js
import { withHeader } from 'sea_sdk_js';

const task = await client.modal.create(
  {
    moderation: true,
    model: 'alibaba_wanx26_i2v_flash',
    input: [
      {
        params: {
          input: {
            img_url: 'https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg',
            prompt: 'A dog and a girl playing happily in an autumn park',
          },
          parameters: {
            resolution: '720P',
            duration: 5,
            prompt_extend: true,
            watermark: false,
          },
        },
      },
    ],
  },
  withHeader('X-Trace-Id', 'trace-123'),
);

console.log(task.id, task.status);
```

`moderation` is a boolean and is optional; `true` means allowlisted, and `false` means not allowlisted. `params` contains model parameters, and the specific structure is determined by the model definition.

**Method 2: Use the typed helper to build the request body**

```js
import { newTask } from 'sea_sdk_js';

const body = newTask('alibaba_wanx26_i2v_flash')
  .moderation(true)
  .params({
    input: {
      img_url: 'https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg',
      prompt: 'A dog and a girl playing happily in an autumn park',
    },
    parameters: {
      resolution: '720P',
      duration: 5,
      prompt_extend: true,
      watermark: false,
    },
  })
  .metadata('trace_id', 'trace-123')
  .build();

const task = await client.modal.create(body);
```

**Polling results**

```js
import {
  withPollInterval,
  withPollTimeout,
} from 'sea_sdk_js';

const task = await client.modal.wait(
  'task_abc123',
  withPollInterval(3000),
  withPollTimeout(300_000),
);

console.log(task.status, task.progress, task.urls());
```

You can also continue waiting after creation:

```js
const task = await client.modal.create({ model: 'alibaba_wanx26_i2v_flash' });
const done = await task.wait(withPollInterval(5000));
```

Uppercase aliases are also provided for compatibility with Go-style naming:

```js
const task = await client.Modal.Create(body);
```

### Precharge Estimate

Precharge estimate request parameters are the same as task creation and can be used to estimate costs in advance. Two common methods are supported: pass the raw request object directly, or use the `newTask` typed helper to build the request body.

**Method 1: Pass the raw request object directly**

```js
const resp = await client.modal.precharge({
  id: 'd88pmute87128c73e9r0d0',
  model: 'volces_seedream_4_5',
  input: [
    {
      params: {
        prompt: 'A dog',
      },
    },
  ],
  moderation: false,
});

console.log(resp.status);
console.log(resp.data.billing_model, resp.data.cost, resp.data.currency);
```

**Method 2: Use the typed helper to build the request body**

```js
const body = newTask('volces_seedream_4_5')
  .moderation(false)
  .field('id', 'd88pmute87128c73e9r0d0')
  .params({ prompt: 'A dog' })
  .build();

const resp = await client.modal.precharge(body);

console.log(resp.status);
console.log(resp.data.billing_model, resp.data.cost, resp.data.currency);
```

**Response example**

```json
{
  "status": "success",
  "data": {
    "model": "volces_seedream_4_5",
    "original_model": "volces_seedream_4_5",
    "billing_model": "volces_seedream_4_5",
    "sample_count": 1,
    "cost": "0.2",
    "currency": "credit",
    "discount": 1,
    "hash": "example-hash",
    "updated_at": 1710000000
  }
}
```

### Passthrough API (Vendor Passthrough)

The passthrough layer preserves the vendor's original API shape. Paths must include the vendor prefix, such as `/kling/...`, `/vidu/...`, or `/google/...`.

**Method 1: JSON object request**

```js
const resp = await client.passthrough.post(
  '/kling/v1/videos/text2video',
  {
    model_name: 'kling-v1',
    prompt: 'cinematic shot',
  },
  withHeader('X-Trace-Id', 'trace-123'),
);

console.log(resp.statusCode, await resp.text());
```

**Method 2: Raw byte passthrough**

```js
const body = new TextEncoder().encode('{"contents":[{"parts":[{"text":"paint a cat"}]}]}');

const resp = await client.passthrough.requestRaw(
  'POST',
  '/google/v1beta/models/gemini-2.5-flash-image:generateContent',
  body,
);

console.log(resp.statusCode, await resp.text());
```

Currently provided:

- `request`
- `requestRaw`
- `get`
- `post`
- `put`
- `delete`

## Image/Video Safety Scan

The image/video safety scan API maps to `POST /v1/image/scan` and is used to detect content-safety risks in images, GIFs, or videos. When calling it, provide either the media URL or base64 image content, and specify the risk types through `risk_types`.

```js
import {
  ImageScanRiskTypeChild,
  ImageScanRiskTypeErotic,
  ImageScanRiskTypePolity,
  ImageScanRiskTypeViolent,
} from 'sea_sdk_js';

const result = await client.modal.scanImage({
  uri: 'https://example.com/image.jpg',
  risk_types: [
    ImageScanRiskTypePolity,
    ImageScanRiskTypeErotic,
    ImageScanRiskTypeViolent,
    ImageScanRiskTypeChild,
  ],
  detected_age: 0,
  is_video: 0,
});

console.log(result.ok, result.nsfw_level, result.risk_types);
```

Video detection is also supported:

```js
const result = await client.modal.scanImage({
  uri: 'https://example.com/video.mp4',
  risk_types: [ImageScanRiskTypeErotic, ImageScanRiskTypeViolent],
  is_video: 1,
  duration: 12.5,
});
```

Base64 image content is also supported:

```js
const result = await client.modal.scanImage({ img_base64: 'base64-image-content' });
```

**Pass response example**

```json
{
  "label_items": [],
  "risk_types": [],
  "usage": {
    "cost": "0.1"
  },
  "ok": true,
  "nsfw_level": 0
}
```

**Risk-hit response example**

```json
{
  "nsfw_level": 5,
  "label_items": [
    {
      "name": "erotic_sexual_body",
      "score": 98,
      "risk_type": "EROTIC"
    }
  ],
  "risk_types": ["EROTIC"],
  "usage": {
    "cost": "0.1"
  },
  "ok": false
}
```

## Sensitive-Word Scan

The sensitive-word scan API maps to `POST /v1/text/scan` and is used to detect sensitive words, combination words, and risk-hit results in input text.

```js
const result = await client.modal.scanText({
  text: 'a cute cat sitting on the sofa',
  scene: 1,
  area_types: [2],
  way: 0,
});

console.log(result.data.is_sensitive);
console.log(result.data.sensitive_words);
console.log(result.extra);
```

**Pass response example**

```json
{
  "usage": {
    "cost": "1"
  },
  "data": {
    "sensitive_words": [],
    "combination": null,
    "is_sensitive": false
  },
  "status": {
    "msg": "success",
    "request_id": "b5ebfb02a9d11adf98b05b397bd82e9e",
    "code": 10000
  }
}
```

## Text Content Safety Scan

The text content safety scan API maps to `POST /v1/text/content/scan` and is used to review short text for content safety. This API coexists with the legacy sensitive-word scan API `POST /v1/text/scan`.

```js
const result = await client.modal.scanTextContent({
  text: 'hello world',
  canary: 'A',
  scene: 'user_name',
});

console.log(result.ok, result.level, result.label, result.reason);
console.log(result.usage);
```

**Response fields**

| Field | Type | Description |
|------|------|------|
| `ok` | `boolean` | Whether the review succeeded |
| `level` | `number` | Risk level, range `0-6`; higher values indicate higher risk |
| `label` | `string` | Category label, in English |
| `reason` | `string` | Decision reason, in English, or error reason |
| `usage` | `object` | Billing information injected by the gateway |
| `extra` | `object` | Unmodeled fields returned by the upstream service |

**Pass response example**

```json
{
  "ok": true,
  "level": 0,
  "label": "normal",
  "reason": "Neutral greeting expression",
  "usage": {
    "cost": "0.001"
  }
}
```

## Face Scan

The face scan API maps to `POST /v1/face/scan` and is used to detect face-related results in images or videos. You can pass a media URL or image base64 content.

```js
const result = await client.modal.scanFace({
  uri: 'https://example.com/image.jpg',
  is_video: 0,
  scene: 'avatar',
});

console.log(result.ok, result.usage);
console.log(result.extra);
```

**Response fields**

| Field | Type | Description |
|------|------|------|
| `ok` | `boolean` | Whether the detection request completed successfully |
| `error` | `string` | Upstream business error information; usually empty on success |
| `usage` | `object` | Billing information injected by the gateway |
| `extra` | `object` | Unmodeled fields returned by the upstream service, such as face count |

**No-face response example (SDK return structure)**

```json
{
  "ok": true,
  "error": "",
  "usage": {
    "cost": "1"
  },
  "extra": {
    "face_count": 0
  }
}
```

**Face-detected response example (SDK return structure)**

```json
{
  "ok": true,
  "error": "",
  "usage": {
    "cost": "0.002"
  },
  "extra": {
    "face_count": 1
  }
}
```

## Audio Scan

The audio scan API maps to `POST /v1/audio/scan` and is used to detect audio content risks. When calling it, provide an accessible audio URL; `duration` is used for billing and statistics.

```js
const result = await client.modal.scanAudio({
  uri: 'https://example.com/audio/test.mp3',
  rec_type: 'AUDIOPOLITICAL_MOAN_ANTHEN',
  duration: 15,
});

console.log(result.riskLevel, result.allLabels);
console.log(result.extra);
```

**Pass response example**

```json
{
  "code": 1100,
  "message": "success",
  "requestId": "a63b89046c70435a4fb9a0d36439d0ee",
  "btId": "https://example.com/audio/sample.mp3",
  "detail": {
    "audioDetail": [],
    "audioTags": {},
    "audioText": "sample audio transcription text",
    "audioTime": 4,
    "code": 1100,
    "requestParams": {},
    "riskLevel": "PASS"
  }
}
```

## LLM API

Non-streaming LLM methods return raw JSON strings. Use `decode(raw)` to deserialize them:

```js
import { decode } from 'sea_sdk_js';

const raw = await client.llm.chatCompletions({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hello' }],
  max_tokens: 64,
});

const resp = decode(raw);
console.log(resp.choices[0].message.content);
```

Currently supported methods:

| Method | Description |
|------|------|
| `chatCompletions` | Calls the OpenAI-compatible Chat Completions API and returns the raw JSON string |
| `chatCompletionsStream` | Calls the Chat Completions streaming API and returns async-iterable SSE streaming events |
| `messages` | Calls the Anthropic Messages-compatible API and returns the raw JSON string |
| `messagesStream` | Calls the Messages streaming API and returns async-iterable SSE streaming events |
| `responses` | Calls the OpenAI-compatible Responses API and returns the raw JSON string |
| `responsesStream` | Calls the Responses streaming API and returns async-iterable SSE streaming events |
| `rerank` | Calls the text reranking API |
| `embeddings` | Calls the embedding generation API |
| `listModels` | Queries the LLM model list |

Streaming methods return async-iterable SSE streaming events:

```js
for await (const event of client.llm.chatCompletionsStream({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hello' }],
})) {
  if (event.done) {
    break;
  }

  const chunk = decode(event.data);
  console.log(chunk.choices?.[0]?.delta?.content ?? '');
}
```

Responses or Messages streaming responses can use the text assembler helper:

```js
import { ResponsesStreamTextAssembler } from 'sea_sdk_js';

const text = new ResponsesStreamTextAssembler();

for await (const event of client.llm.responsesStream({
  model: 'gpt-4.1-mini',
  input: 'hello',
})) {
  if (!event.done) {
    text.add(decode(event.data));
  }
}

console.log(text.text());
```
