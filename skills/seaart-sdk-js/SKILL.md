---
name: seaart-sdk-js
description: Build and troubleshoot SeaArt AI gateway integrations with the sea_sdk_js client. Use when generating images or videos, searching model skills, estimating multimodal task cost, calling vendor-native passthrough APIs, running media or text safety scans, or using OpenAI- or Anthropic-compatible LLM, streaming, embedding, or rerank APIs from Node.js.
---

# SeaArt JavaScript SDK

Use `sea_sdk_js` to call the SeaArt unified gateway from an ESM Node.js 18+ project. The SDK uses Promises for requests and async iterables for LLM streaming.

## Install

```bash
npm install https://github.com/SeaArt-Infra/sea-sdk-js.git
```

## Workflow

1. Create one `Client` with the API key and reuse it across requests.
2. Select `client.modal` for generation, model skills, precharge, or safety scans; `client.llm` for LLM APIs; and `client.passthrough` for vendor-native paths.
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
