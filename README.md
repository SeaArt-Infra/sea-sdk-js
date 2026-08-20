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
| [ComfyUI Quick Apps](#comfyui-quick-apps) | `client.modal.createComfyUITask(...)` | Query template parameters, create ComfyUI quick-app tasks, and poll results |
| [Image/Video Safety Scan](#imagevideo-safety-scan) | `client.modal.scanImage(...)` | Detect content-safety risks in images, GIFs, or videos |
| [Sensitive-Word Scan](#sensitive-word-scan) | `client.modal.scanText(...)` | Detect sensitive words and combination-rule risks in text |
| [Text Content Safety Scan](#text-content-safety-scan) | `client.modal.scanTextContent(...)` | Review short text risk level and category label |
| [Visual Structured Text Fusion Scan](#visual-structured-text-fusion-scan) | `client.modal.scanVisualStructuredTextFusion(...)` | Scan digital-human cover images and structured copy together |
| [Face Scan](#face-scan) | `client.modal.scanFace(...)` | Detect face-related results in images or videos |
| [Audio Scan](#audio-scan) | `client.modal.scanAudio(...)` | Detect audio content risks |
| [LLM API](#llm-api) | `client.llm` / `client.LLM` | OpenAI / Anthropic / Responses / Embeddings / Rerank compatible APIs |
| [Billing API](#billing-api) | `client.billing` / `client.Billing` | Query the authenticated team's cost statement |

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

## Billing API

`client.billing.query(...)` calls `GET /monitor/api/v1/cost/billing`. The gateway derives the team from the Bearer token and injects `X-User-ID`; callers do not pass a team identifier. By default the query covers `develop` and `release`. Set `environment` to `develop` or `release` to select one environment.

`start` and `end` define the time range. They accept RFC3339 timestamps such as `2026-08-19T00:00:00Z`, UTC date-times without a zone, date-only values such as `2026-08-19`, or Unix seconds. The range is `[start, end)`. When `end` is date-only, that whole day is included; without either value, the server defaults to the previous seven days.

```js
const statement = await client.billing.query({
  start: '2026-08-19T00:00:00Z',
  end: '2026-08-20T00:00:00Z',
  environment: 'release',
  page: 1,
  page_size: 20,
});
console.log(statement.team, statement.summary.total_cost);
for (const item of statement.items.items ?? []) {
  console.log(item.provider, item.model_group, item.total_cost);
}
```

Set `billingBaseURL` only when the billing route is hosted separately; otherwise `baseURL` derives it as `<baseURL>/monitor`.

Configure the unified gateway address through `baseURL`; the SDK uses it to call multimodal, LLM, billing, passthrough, and other capabilities.

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

When a task fails, `wait()` throws `SeaArtError` with `kind`, `taskID`, the gateway error `code`, and the complete gateway error `message`.

```js
try {
  const done = await task.wait(withPollTimeout(300000));
} catch (error) {
  if (error instanceof SeaArtError) {
    console.log(error.kind, error.code, error.message, error.taskID);
  }
}
```

Uppercase aliases are also provided for compatibility with Go-style naming:

```js
const task = await client.Modal.Create(body);
```

### ComfyUI Quick Apps

Pass template IDs to `listComfyUITemplates` to retrieve the corresponding quick-app parameters. `createComfyUITask` fixes the model to `comfyui`, routes it through `X-Model`, and builds the required request envelope.

```js
const specs = await client.modal.listComfyUITemplates(['d32kq8le878c73876j5g']);
const task = await client.modal.createComfyUITask({
  templateId: 'd32kq8le878c73876j5g',
  inputs: [
    { field: 'image', value: 'https://image.cdn2.seaart.me/upload/input.webp' },
    { field: 'select', value: 1 },
  ],
  highMemory: true,
});
const done = await task.wait(withPollInterval(3000), withPollTimeout(300000));
console.log(done.urls());
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

The image/video safety scan API maps to `POST /v1/image/scan` and is used to detect content-safety risks in images or videos. When calling it, provide either the media URL or base64 image content, and specify the risk types through `risk_types`.

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
  detected_age: false,
  is_video: false,
  canary: 'B',
  scene: 'avatar',
});

console.log(result.ok, result.nsfw_level, result.risk_types);
```

Video detection is also supported. Video scans must use `uri` and do not support `img_base64`:

```js
const result = await client.modal.scanImage({
  uri: 'https://example.com/video.mp4',
  risk_types: [ImageScanRiskTypeErotic, ImageScanRiskTypeViolent],
  is_video: true,
  duration: 12.5,
});
```

Base64 image content is also supported for image scans:

```js
const result = await client.modal.scanImage({ img_base64: 'base64-image-content' });
```

To process asynchronously, pass `callback_url`:

```js
const result = await client.modal.scanImage({
  uri: 'https://example.com/image.jpg',
  callback_url: 'https://example.com/callback',
  callback_context: { trace_id: 'trace-123' },
});
```

**Request fields**

| Field | Type | Required | Description |
|------|------|------|------|
| `uri` | `string` | Conditionally required | Image or video URL to scan. Mutually exclusive with `img_base64`; videos must use `uri` |
| `img_base64` | `string` | Conditionally required | Base64-encoded image content. Mutually exclusive with `uri`; videos are not supported |
| `is_video` | `boolean` | No | Whether the file is a video. Defaults to `false` |
| `callback_url` | `string` | Yes for async | Callback URL after detection completes. Only HTTP/HTTPS is supported. Passing this field enables async processing |
| `callback_context` | `object` | No | Caller passthrough fields. The server does not parse or modify them and returns them unchanged in the callback. Maximum 16KB |
| `risk_types` | `array[string]` | No | Risk categories to detect. If omitted, all risk types are detected |
| `detected_age` | `boolean` | No | Whether to perform age detection. Defaults to `false` |
| `canary` | `string` | No | Canary parameter. Defaults to `B` |
| `scene` | `string` | No | Scene identifier used for label-level config lookup and metrics |
| `duration` | `number` | No | Video duration in seconds. Recommended for video scans |

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

console.log(result.ok, result.req_id, result.level, result.label, result.reason);
console.log(result.usage);
```

**Response fields**

| Field | Type | Description |
|------|------|------|
| `ok` | `boolean` | Whether the review succeeded |
| `req_id` | `string` | Downstream request ID for tracing; returned for successful reviews and downstream business validation failures |
| `level` | `number` | Risk level, range `0-6`; higher values indicate higher risk |
| `label` | `string` | Category label, in English |
| `reason` | `string` | Decision reason, in English, or error reason |
| `usage` | `object` | Billing information injected by the gateway |
| `extra` | `object` | Unmodeled fields returned by the upstream service |

**Pass response example**

```json
{
  "ok": true,
  "req_id": "da49eb3d0b4b4d2cb8a64d2c92d70f81",
  "level": 0,
  "label": "normal",
  "reason": "Neutral greeting expression",
  "usage": {
    "cost": "0.001"
  }
}
```

## Visual Structured Text Fusion Scan

The visual structured text fusion scan endpoint is `POST /v1/visual/structured/text/fusion/scan`. It evaluates a digital-human cover image together with structured copy. `text_dict` supports nested objects, and image URLs inside it are also scanned.

```js
const result = await client.modal.scanVisualStructuredTextFusion({
  uri: 'https://example.com/cover.jpg',
  text_dict: {
    name: 'Xiaomei',
    personality: 'Gentle and considerate',
    description: 'Enjoys traveling',
    greeting: 'Hello',
  },
  business_type: 'v1',
  canary: 'A',
  mode: 'mixed',
  ocr: 1,
});

console.log(result.ok, result.nsfw_level, result.issue_source, result.risk_keys);
console.log(result.req_id, result.reason, result.img_reason, result.text_reason);
console.log(result.usage);
```

`text_dict` is required, and at least one of `uri` and `img_base64` must be provided. If both image inputs are provided, the downstream service prioritizes `img_base64`. Optional fields use downstream defaults when omitted. The downstream service may return HTTP 200 for business validation failures; check `result.ok`.

| Field | Type | Required | Description |
|------|------|------|------|
| `text_dict` | `object` | Yes | Structured copy, including nested objects and image URLs |
| `img_base64` | `string` | Conditional | Main image base64 without a data URL prefix |
| `uri` | `string` | Conditional | Public image URL or internal storage URI |
| `business_type` | `string` | No | Image small-model business type; downstream default is `v1` |
| `detected_age` | `number` | No | Known age; downstream default is `0` |
| `hash_comparison` | `number` | No | Whether to enable hash comparison; downstream default is `0` |
| `canary` | `string` | No | Canary group; downstream default is `A` |
| `mode` | `string` | No | Detection mode; downstream default is `mixed` |
| `ocr` | `number` | No | Whether to enable OCR; downstream default is `0` |

**Response fields**

| Field | Type | Description |
|------|------|------|
| `ok` | `boolean` | Whether the downstream scan completed successfully |
| `nsfw_level` | `number` | Highest risk level across the main image, image/text model, and linked images |
| `reason` | `string` | Combined judgment reason or business validation error |
| `img_reason` | `string` | Image-side risk reason |
| `text_reason` | `string` | Text-side risk reason |
| `issue_source` | `string` | Risk source: `img`, `text`, `both`, or `none` |
| `risk_keys` | `string[]` | `text_dict` fields that contain risk |
| `req_id` | `string` | Downstream request ID for tracing, including business validation failures |
| `msg` | `string` | Downstream service error message |
| `usage` | `object` | Gateway-injected billing metadata |
| `extra` | `object` | Upstream fields not modeled by the SDK |

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

<script
  type="text/plain"
  data-doc-skill
  data-doc-skill-id="seaart-sdk-js"
  data-doc-skill-label="SeaArt JavaScript SDK"
  data-doc-skill-filename="seaart-sdk-js-SKILL.md"
  data-doc-skill-version="1"
>
---
name: seaart-sdk-js
description: Build and troubleshoot SeaArt AI gateway integrations with the sea_sdk_js client. Use when generating images or videos, calling ComfyUI quick-app templates, searching model skills, estimating multimodal task cost, calling vendor-native passthrough APIs, running media or text safety scans, or using OpenAI- or Anthropic-compatible LLM, streaming, embedding, or rerank APIs from Node.js.
---

# SeaArt JavaScript SDK

Use `sea_sdk_js` to call the SeaArt unified gateway from an ESM Node.js 18+ project. The SDK uses Promises for requests and async iterables for LLM streaming.

## Install

```bash
npm install https://github.com/SeaArt-Infra/sea-sdk-js.git
```

## Workflow

1. Create one `Client` with the API key and reuse it across requests.
2. Select `client.modal` for generation, model skills, precharge, or safety scans; `client.billing` for team-scoped cost statements; `client.llm` for LLM APIs; and `client.passthrough` for vendor-native paths.
3. For a multimodal model, retrieve `client.modal.getModelSkill(model)` before building model-specific parameters.
4. Poll generation tasks with `task.wait(...)`, then inspect `task.output` after completion.
5. Decode successful LLM JSON strings with `decode`; catch `SeaArtError` at the request boundary.

## Initialize Client

```js
import { Client } from 'sea_sdk_js';

const client = new Client({
  apiKey: 'sa-your-api-key',
  baseURL: 'https://gateway.example.com', // optional
  project: 'my-project',                  // optional X-Project header
  timeout: 60_000,
});
```

Passing `baseURL` derives `/model` and `/llm` service URLs. Override `modelBaseURL`, `llmBaseURL`, or `passthroughBaseURL` only when services use separate gateways. Do not expose API keys in source control or logs.

Keep the selected model in the SDK payload's top-level `model` field. The SDK sends it as the `X-Model` header and removes it from the serialized JSON body. Do not pass `X-Model` with `withHeader(...)` when the payload already contains `model`.

## Multimodal Tasks

Search before choosing a model, and retrieve its model skill when exact parameter names matter:

```js
const models = await client.modal.listModels({ query: 'image', limit: 10 });
console.log(models.hits);

const skill = await client.modal.getModelSkill('alibaba_wanx26_i2v_flash');
console.log(skill);
```

Pass the documented model parameters in `input[*].params`, or build the same payload with `newTask(...)`:

```js
import { newTask, withPollInterval, withPollTimeout } from 'sea_sdk_js';

const body = newTask('alibaba_wanx26_i2v_flash')
  .moderation(true)
  .params({
    input: {
      img_url: 'https://example.com/input.jpg',
      prompt: 'A cinematic mountain sunrise',
    },
    parameters: { resolution: '720P', duration: 5 },
  })
  .build();

const task = await client.modal.create(body);
const completed = await task.wait(withPollInterval(3000), withPollTimeout(300_000));
for (const output of completed.output) {
  for (const content of output.content ?? []) {
    console.log(content.url);
  }
}
```

Use `client.modal.precharge(body)` before a generation request when cost estimation is required. Do not assume every model uses the `input` and `parameters` nesting: follow the result from `getModelSkill`.

## Billing Queries

Use `client.billing.query({...})` for the authenticated team's cost statement. The gateway derives the team from the Bearer token, so callers must not pass `team_alias`. The default environment scope is `develop` plus `release`; set `environment` to one of those values to select a single environment. Use `start`, `end`, `provider`, `credential_name`, `model_group`, `page`, and `page_size` for supported filters.
Use RFC3339 or date-only values for `start`/`end`; the range is `[start, end)`, and omitted values default to the previous seven days.

## ComfyUI Quick Apps

Use `listComfyUITemplates(templateIds)` to retrieve parameters for the supplied template IDs, then call `createComfyUITask({ templateId, inputs, highMemory })` and poll with `task.wait(...)`.

```js
const task = await client.modal.createComfyUITask({
  templateId: 'd32kq8le878c73876j5g',
  inputs: [
    { field: 'image', value: 'https://image.cdn2.seaart.me/upload/input.webp' },
    { field: 'select', value: 1 },
  ],
  highMemory: true,
});
const done = await task.wait(withPollInterval(3000), withPollTimeout(300000));
console.log(done.urls());
```

## LLM And Streaming APIs

Non-streaming LLM methods return raw JSON strings. Deserialize them with `decode`:

```js
import { decode } from 'sea_sdk_js';

const raw = await client.llm.chatCompletions({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
});
const response = decode(raw);
console.log(response.choices[0].message.content);
```

Use the dedicated streaming methods rather than setting `stream: true` on non-streaming methods. Stop on `done`; stream-read failures throw `SeaArtError` from the iterator:

```js
for await (const event of client.llm.chatCompletionsStream({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
})) {
  if (event.done) {
    break;
  }
  const chunk = decode(event.data);
  process.stdout.write(chunk.choices?.[0]?.delta?.content ?? '');
}
```

Use `client.llm.messages` / `messagesStream` for Anthropic Messages and `responses` / `responsesStream` for OpenAI Responses. Accumulate their text with `MessagesStreamTextAssembler` or `ResponsesStreamTextAssembler`. Use `embeddings`, `rerank`, and `listModels` for their corresponding LLM endpoints.

## Passthrough, Scans, And Errors

Use passthrough only for a vendor-native path such as `/kling/...`, `/vidu/...`, or `/google/...`; pass a relative path and preserve the returned status, headers, and raw body.

Use the dedicated scan methods for image/video, face, audio, sensitive-word, short-text, or visual-and-structured-text checks. Image and face scans accept either `uri` or `img_base64`; video and audio scans require `uri`.

```js
import { ErrAuth, ErrQuota, ErrTimeout, SeaArtError } from 'sea_sdk_js';

try {
  await client.modal.scanText({ text: 'Text to check' });
} catch (error) {
  if (error instanceof SeaArtError && [ErrAuth, ErrQuota, ErrTimeout].includes(error.kind)) {
    throw error;
  }
  throw error;
}
```

Handle `ErrAuth`, `ErrQuota`, `ErrTimeout`, `ErrNetwork`, and `ErrTaskFailed` explicitly where retries or user feedback differ. For failed multimodal tasks, inspect `SeaArtError.taskID` and the model response before retrying.
</script>
