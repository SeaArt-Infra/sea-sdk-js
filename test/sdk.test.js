import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  Client,
  ErrAuth,
  ErrTaskFailed,
  FileID,
  ImageURL,
  ImageScanRiskTypeErotic,
  ImageScanRiskTypeViolent,
  MessagesStreamTextAssembler,
  ResponsesStreamTextAssembler,
  SeaArtError,
  Text,
  decode,
  newTask,
  withHeader,
  withHeaders,
  withPollInterval,
  withPollTimeout,
} from '../src/index.js';

test('Client derives default and service base URLs', () => {
  const defaults = new Client({ apiKey: 'test-key' });
  assert.equal(defaults.baseURL, 'https://gateway.example.com');
  assert.equal(defaults.modelBaseURL, 'https://gateway.example.com/model');
  assert.equal(defaults.llmBaseURL, 'https://gateway.example.com/llm');
  assert.equal(defaults.passthroughBaseURL, 'https://gateway.example.com/model');

  const derived = new Client({ apiKey: 'test-key', baseURL: 'https://gateway.example.com/' });
  assert.equal(derived.baseURL, 'https://gateway.example.com');
  assert.equal(derived.modelBaseURL, 'https://gateway.example.com/model');
  assert.equal(derived.llmBaseURL, 'https://gateway.example.com/llm');
  assert.equal(derived.passthroughBaseURL, 'https://gateway.example.com/model');

  const overridden = new Client({
    apiKey: 'test-key',
    baseURL: 'https://gateway.example.com',
    modelBaseURL: 'https://model.example.com',
    llmBaseURL: 'https://llm.example.com',
    passthroughBaseURL: 'https://passthrough.example.com',
  });
  assert.equal(overridden.modelBaseURL, 'https://model.example.com');
  assert.equal(overridden.llmBaseURL, 'https://llm.example.com');
  assert.equal(overridden.passthroughBaseURL, 'https://passthrough.example.com');
});

test('Client rejects invalid base URL', () => {
  assert.throws(() => new Client({ baseURL: '://bad' }), SeaArtError);
});

test('Modal create submits params body and attaches task client', async (t) => {
  const client = await testClient(t, async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/generation');
    assert.equal(req.headers.authorization, 'Bearer test-key');
    assert.equal(req.headers['x-trace-id'], 'trace-123');
    assert.equal(req.headers['x-model'], 'alibaba_wanx26_i2v_flash');

    const body = await readJSON(req);
    assert.equal(body.model, undefined);
    assert.equal(body.moderation, true);
    assert.equal(body.input[0].params.input.prompt, '小狗和女孩在秋天的公园里快乐地玩耍');
    assert.equal(body.input[0].params.parameters.duration, 5);
    writeJSON(res, 200, { id: 'task_create', status: 'in_progress', model: 'alibaba_wanx26_i2v_flash' });
  });

  const request = {
    moderation: true,
    model: 'alibaba_wanx26_i2v_flash',
    input: [{
      params: {
        input: {
          img_url: 'https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg',
          prompt: '小狗和女孩在秋天的公园里快乐地玩耍',
        },
        parameters: {
          resolution: '720P',
          duration: 5,
          prompt_extend: true,
          watermark: false,
        },
      },
    }],
  };
  const task = await client.modal.create(request, withHeader('X-Trace-Id', 'trace-123'));

  assert.equal(request.model, 'alibaba_wanx26_i2v_flash');
  assert.equal(task.id, 'task_create');
  assert.equal(task.ID, 'task_create');
  assert.equal(task.status, 'in_progress');
  assert.equal(task.model, 'alibaba_wanx26_i2v_flash');
});


test('Modal precharge returns billing preview', async (t) => {
  const client = await testClient(t, async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/generation/precharge');
    assert.equal(req.headers['x-model'], 'volces_seedream_4_5');
    const body = await readJSON(req);
    assert.equal(body.id, 'd88pmute87128c73e9r0d0');
    assert.equal(body.model, undefined);
    assert.equal(body.input[0].params.prompt, 'A dog');
    assert.equal(body.moderation, false);
    writeJSON(res, 200, {
      data: {
        billing_model: 'volces_seedream_4_5',
        cost: '0.035714285714',
        currency: 'USD',
        discount: 0.7,
        hash: 'v1:18a733f04d227d572950ed8f1f98a9ba4cd37c168c5c98c05a5e574984f58eaf',
        model: 'volces_seedream_4_5',
        original_model: 'volces_seedream_4_5',
        sample_count: 4,
        updated_at: 1780633394064,
      },
      status: 'success',
    });
  });

  const resp = await client.modal.precharge({
    id: 'd88pmute87128c73e9r0d0',
    model: 'volces_seedream_4_5',
    input: [{ params: { prompt: 'A dog' } }],
    moderation: false,
  });

  assert.equal(resp.status, 'success');
  assert.equal(resp.data.billing_model, 'volces_seedream_4_5');
  assert.equal(resp.data.cost, '0.035714285714');
  assert.equal(resp.data.sample_count, 4);
});

test('Modal ComfyUI helpers build fixed request shape and query template specs', async (t) => {
  const client = await testClient(t, async (req, res) => {
    if (req.url === '/v1/template/specs') {
      assert.equal(req.method, 'POST');
      assert.deepEqual(await readJSON(req), { type: 'comfyui', template_ids: ['template-1'] });
      writeJSON(res, 200, {
        type: 'comfyui',
        templates: [{ template_id: 'template-1', inputs: [{ field: 'prompt', required: true, constraints: { default: 'hello' } }], outputs: [{ node_id: '3', node_type: 'SaveImage' }] }],
      });
      return;
    }
    assert.equal(req.url, '/v1/generation');
    assert.equal(req.headers['x-model'], 'comfyui');
    const body = await readJSON(req);
    assert.equal(body.model, undefined);
    assert.deepEqual(body.input[0].params, {
      template_id: 'template-1',
      high_memory: true,
      inputs: [{ field: 'prompt', value: 'hello' }],
    });
    writeJSON(res, 200, { id: 'task-comfy', status: 'in_progress', model: 'comfyui' });
  });

  const task = await client.modal.createComfyUITask({
    templateId: 'template-1',
    inputs: [{ field: 'prompt', value: 'hello' }],
    highMemory: true,
  });
  assert.equal(task.id, 'task-comfy');
  const specs = await client.modal.listComfyUITemplates(['template-1']);
  assert.equal(specs.templates[0].inputs[0].field, 'prompt');
  assert.equal(specs.templates[0].outputs[0].node_type, 'SaveImage');
});

test('Modal precharge supports cache miss response', async (t) => {
  const client = await testClient(t, async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/generation/precharge');
    writeJSON(res, 200, {
      data: {
        cost: null,
        hash: 'v1:02833b68895eeb61bf214d35fd669502ef788e4c8d58505893414ae9632ca8ab',
        model: 'volces_seedream_4_5',
        original_model: 'volces_seedream_4_5',
        reason: 'COST_CACHE_MISS',
      },
      status: 'failed',
    });
  });

  const body = newTask('volces_seedream_4_5')
    .Field('id', 'd88pmute87128c73e9r0d0')
    .Moderation(false)
    .Params({ prompt: 'A dog' })
    .Build();
  const resp = await client.Modal.Precharge(body);

  assert.equal(resp.status, 'failed');
  assert.equal(resp.data.cost, null);
  assert.equal(resp.data.reason, 'COST_CACHE_MISS');
});

test('Modal listModels and getModelSkill use skill endpoints', async (t) => {
  const client = await testClient(t, async (req, res) => {
    if (req.url.startsWith('/v1/models/skill/search')) {
      assert.equal(req.method, 'GET');
      assert.equal(req.headers.accept, 'application/json');
      const url = new URL(req.url, 'http://localhost');
      assert.equal(url.searchParams.get('q'), 'animate');
      assert.equal(url.searchParams.get('input'), 'image');
      assert.equal(url.searchParams.get('output'), 'video');
      assert.equal(url.searchParams.get('type'), 'i2v');
      assert.equal(url.searchParams.get('provider'), 'alibaba');
      assert.equal(url.searchParams.get('limit'), '2');
      writeJSON(res, 200, { hits: [{ name: 'alibaba_animate_anyone_detect' }], query: 'animate', limit: 2, estimatedTotalHits: 1 });
      return;
    }

    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/v1/models/skill/alibaba_animate_anyone_detect');
    assert.equal(req.headers.accept, 'application/json');
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    res.end('# alibaba_animate_anyone_detect\n\nparameters');
  });

  const models = await client.Modal.ListModels({
    Query: 'animate',
    Input: 'image',
    Output: 'video',
    Type: 'i2v',
    Provider: 'alibaba',
    Limit: 2,
  });
  assert.equal(models.query, 'animate');
  assert.equal(models.hits[0].name, 'alibaba_animate_anyone_detect');

  const skill = await client.modal.getModelSkill('alibaba_animate_anyone_detect');
  assert.equal(skill, '# alibaba_animate_anyone_detect\n\nparameters');
});

test('Modal scan APIs normalize Go and JS request field names', async (t) => {
  const seen = [];
  const client = await testClient(t, async (req, res) => {
    seen.push(req.url);
    const body = await readJSON(req);

    if (req.url === '/v1/image/scan') {
      if (body.img_base64) {
        assert.equal(body.uri, undefined);
        assert.equal(body.img_base64, 'abc123');
        writeJSON(res, 200, { ok: true, nsfw_level: 0, usage: { cost: '0.001' } });
        return;
      }
      assert.equal(body.uri, 'https://example.com/image.jpg');
      assert.deepEqual(body.risk_types, [ImageScanRiskTypeErotic, ImageScanRiskTypeViolent]);
      assert.equal(body.detected_age, true);
      assert.equal(body.is_video, false);
      assert.equal(body.callback_url, 'https://example.com/callback');
      assert.deepEqual(body.callback_context, { trace_id: 'trace-scan' });
      assert.equal(body.canary, 'B');
      assert.equal(body.scene, 'avatar');
      writeJSON(res, 200, { ok: true, nsfw_level: 2, usage: { cost: '0.001' } });
      return;
    }

    if (req.url === '/v1/text/scan') {
      assert.equal(body.text, 'a prompt to check');
      assert.equal(body.scene, 1);
      assert.deepEqual(body.area_types, [2]);
      writeJSON(res, 200, {
        data: {
          sensitive_words: [{ word: 'blocked', start_index: 2, end_index: 8, risk_type_code: 'political' }],
          combination: null,
          is_sensitive: false,
        },
        status: { code: 10000, msg: 'success', request_id: 'risk-req-1' },
        usage: { cost: '0.003' },
      });
      return;
    }

    if (req.url === '/v1/text/content/scan') {
      assert.equal(body.text, 'hello world');
      assert.equal(body.canary, 'A');
      assert.equal(body.scene, 'user_name');
      assert.equal(body.Text, undefined);
      assert.equal(body.Canary, undefined);
      assert.equal(body.Scene, undefined);
      writeJSON(res, 200, {
        ok: true,
        req_id: 'content-risk-1',
        level: 0,
        label: 'normal',
        reason: 'Neutral greeting expression',
        usage: { cost: '0.001' },
      });
      return;
    }

    if (req.url === '/v1/audio/scan') {
      assert.equal(body.uri, 'https://example.com/audio/test.mp3');
      assert.equal(body.rec_type, 'AUDIOPOLITICAL_MOAN_ANTHEN');
      assert.equal(body.duration, 15);
      writeJSON(res, 200, {
        riskDescription: '涉政音频',
        riskLevel: 'REJECT',
        allLabels: [{ label1: 'politics', label2: 'leader', description: '涉政内容' }],
        usage: { cost: '0.001' },
        request_id: 'audio-risk-1',
      });
      return;
    }

    assert.equal(req.url, '/v1/face/scan');
    assert.equal(body.uri, 'https://example.com/face.jpg');
    assert.equal(body.is_video, 0);
    assert.equal(body.scene, 'avatar');
    writeJSON(res, 200, { ok: true, face_count: 1, usage: { cost: '0.002' } });
  });

  const image = await client.modal.scanImage({
    URI: 'https://example.com/image.jpg',
    RiskTypes: [ImageScanRiskTypeErotic, ImageScanRiskTypeViolent],
    DetectedAge: true,
    IsVideo: false,
    CallbackURL: 'https://example.com/callback',
    CallbackContext: { trace_id: 'trace-scan' },
    Canary: 'B',
    Scene: 'avatar',
  });
  assert.equal(image.ok, true);
  assert.equal(image.nsfw_level, 2);

  const imageBase64 = await client.modal.scanImage({ ImgBase64: 'abc123' });
  assert.equal(imageBase64.ok, true);
  assert.equal(imageBase64.nsfw_level, 0);

  await assert.rejects(
    () => client.modal.scanImage({ uri: 'https://example.com/image.jpg', img_base64: 'abc123' }),
    SeaArtError,
  );
  await assert.rejects(
    () => client.modal.scanImage({ img_base64: 'abc123', is_video: true }),
    SeaArtError,
  );

  const text = await client.modal.scanText({ Text: 'a prompt to check', Scene: 1, AreaTypes: [2], Way: 0 });
  assert.equal(text.status.code, 10000);
  assert.deepEqual(text.data.sensitive_words, [{ word: 'blocked', start_index: 2, end_index: 8, risk_type_code: 'political' }]);
  assert.equal(text.data.combination, null);
  assert.equal(text.data.is_sensitive, false);
  assert.deepEqual(text.extra, {});

  const textContent = await client.Modal.ScanTextContent({ Text: 'hello world', Canary: 'A', Scene: 'user_name' });
  assert.equal(textContent.ok, true);
  assert.equal(textContent.req_id, 'content-risk-1');
  assert.equal(textContent.level, 0);
  assert.equal(textContent.label, 'normal');
  assert.equal(textContent.reason, 'Neutral greeting expression');
  assert.equal(textContent.usage.cost, '0.001');
  assert.equal(textContent.extra.req_id, undefined);

  const face = await client.modal.scanFace({ URI: 'https://example.com/face.jpg', IsVideo: 0, Scene: 'avatar' });
  assert.equal(face.ok, true);
  assert.equal(face.extra.face_count, 1);

  const audio = await client.modal.scanAudio({
    URI: 'https://example.com/audio/test.mp3',
    RecType: 'AUDIOPOLITICAL_MOAN_ANTHEN',
    Duration: 15,
  });
  assert.equal(audio.riskLevel, 'REJECT');
  assert.equal(audio.allLabels[0].label1, 'politics');
  assert.equal(audio.usage.cost, '0.001');
  assert.equal(audio.extra.request_id, 'audio-risk-1');
  assert.deepEqual(seen, ['/v1/image/scan', '/v1/image/scan', '/v1/text/scan', '/v1/text/content/scan', '/v1/face/scan', '/v1/audio/scan']);
});

test('Modal structured text fusion scan normalizes request and response', async (t) => {
  const client = await testClient(t, async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/visual/structured/text/fusion/scan');
    const body = await readJSON(req);
    assert.equal(body.text_dict.name, '小美');
    assert.equal(body.uri, 'https://example.com/cover.jpg');
    assert.equal(body.business_type, 'v1');
    assert.equal(body.detected_age, 0);
    assert.equal(body.hash_comparison, 1);
    assert.equal(body.canary, 'A');
    assert.equal(body.mode, 'mixed');
    assert.equal(body.ocr, 1);
    writeJSON(res, 200, {
      ok: true,
      nsfw_level: 2,
      reason: 'detected risk',
      img_reason: 'adult content',
      text_reason: 'inappropriate words',
      issue_source: 'both',
      risk_keys: ['description', 'greeting'],
      req_id: 'fusion-1',
      usage: { cost: '0.001' },
    });
  });

  const response = await client.Modal.ScanVisualStructuredTextFusion({
    TextDict: { name: '小美', greeting: '你好呀' },
    URI: 'https://example.com/cover.jpg',
    BusinessType: 'v1',
    DetectedAge: 0,
    HashComparison: 1,
    Canary: 'A',
    Mode: 'mixed',
    OCR: 1,
  });
  assert.equal(response.ok, true);
  assert.equal(response.nsfw_level, 2);
  assert.equal(response.issue_source, 'both');
  assert.deepEqual(response.risk_keys, ['description', 'greeting']);
  assert.equal(response.req_id, 'fusion-1');
  assert.equal(response.usage.cost, '0.001');
  assert.equal(response.extra.req_id, undefined);

  await assert.rejects(
    () => client.modal.scanVisualStructuredTextFusion({ text_dict: {} }),
    SeaArtError,
  );
  await assert.rejects(
    () => client.modal.scanVisualStructuredTextFusion({ text_dict: { name: '小美' } }),
    SeaArtError,
  );
});

test('Modal wait completes and Task.wait uses attached client', async (t) => {
  let polls = 0;
  const client = await testClient(t, async (req, res) => {
    if (req.url === '/v1/generation') {
      writeJSON(res, 200, { id: 'task_attached', status: 'in_progress', model: 'vidu_q3_reference' });
      return;
    }

    assert.equal(req.url, '/v1/generation/task/task_attached');
    polls += 1;
    writeJSON(res, 200, {
      id: 'task_attached',
      status: polls === 1 ? 'in_progress' : 'completed',
      progress: polls === 1 ? 0.4 : 1,
      model: 'vidu_q3_reference',
    });
  });

  const created = await client.modal.create({ model: 'vidu_q3_reference' });
  const task = await created.wait(withPollInterval(10), withPollTimeout(2000));
  assert.equal(task.status, 'completed');
  assert.equal(polls, 2);
});

test('Modal wait returns task_failed errors for failed tasks', async (t) => {
  const client = await testClient(t, async (_req, res) => {
    writeJSON(res, 200, { id: 'task_fail', status: 'failed', error: { error_message: 'provider rejected request' } });
  });

  await assert.rejects(
    client.modal.wait('task_fail', withPollInterval(10), withPollTimeout(2000)),
    (error) => error instanceof SeaArtError && error.kind === ErrTaskFailed && error.taskID === 'task_fail',
  );
});

test('Modal wait preserves failed task error message and code', async (t) => {
  const client = await testClient(t, async (_req, res) => {
    writeJSON(res, 200, {
      id: 'task_fail_details',
      status: 'failed',
      error: {
        code: 110001,
        message: 'input image may contain sensitive information',
        vendor_response: { http_status: 400, body: { error: { code: 'InvalidParameter' } } },
      },
    });
  });

  const failed = await client.modal.get('task_fail_details');
  assert.deepEqual(failed.error, { code: 110001, message: 'input image may contain sensitive information' });
  assert.equal(failed.error.vendor_response, undefined);

  await assert.rejects(
    client.modal.wait('task_fail_details', withPollInterval(10), withPollTimeout(2000)),
    (error) => error instanceof SeaArtError
      && error.kind === ErrTaskFailed
      && error.code === 110001
      && error.message === 'task failed: input image may contain sensitive information (task_id: task_fail_details)',
  );
});

test('Task builder builds nested params modal request', () => {
  const body = newTask('alibaba_wanx26_i2v_flash')
    .Moderation(true)
    .Params({
      input: {
        img_url: 'https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg',
        prompt: '小狗和女孩在秋天的公园里快乐地玩耍',
      },
      parameters: {
        resolution: '720P',
        prompt_extend: true,
        watermark: false,
      },
    })
    .Param('duration', 5)
    .Metadata('trace_id', 'trace-123')
    .Build();

  assert.equal(body.model, 'alibaba_wanx26_i2v_flash');
  assert.equal(body.moderation, true);
  assert.equal(body.input[0].params.input.prompt, '小狗和女孩在秋天的公园里快乐地玩耍');
  assert.equal(body.input[0].params.parameters.resolution, '720P');
  assert.equal(body.input[0].params.parameters.duration, 5);
  assert.equal(body.metadata.trace_id, 'trace-123');
});


test('Task builder keeps legacy user helpers import-compatible', () => {
  const body = newTask('vidu_q3_reference')
    .User(
      Text('cinematic shot'),
      ImageURL('https://example.com/ref1.webp'),
    )
    .Param('duration', 5)
    .Build();

  assert.equal(body.model, 'vidu_q3_reference');
  assert.equal(body.input[0].params.input[0].type, 'message');
  assert.equal(body.input[0].params.input[0].role, 'user');
  assert.deepEqual(body.input[0].params.input[0].content[0], { type: 'text', text: 'cinematic shot' });
  assert.equal(body.input[0].params.parameters.duration, 5);
  assert.deepEqual(FileID('file_123'), { type: 'file_id', file_id: 'file_123' });
});

test('Task builder builds flat params with top-level fields', () => {
  const body = newTask('grok_imagine_image')
    .Field('dash_scope', true)
    .Moderation(true)
    .Params({
      aspect_ratio: '1:2',
      prompt: 'Lego art version of Superman and Batman，Night scene',
      n: 1,
      resolution: '1k',
    })
    .Build();

  assert.equal(body.dash_scope, true);
  assert.equal(body.moderation, true);
  assert.equal(body.input[0].params.aspect_ratio, '1:2');
  assert.equal(body.input[0].params.prompt, 'Lego art version of Superman and Batman，Night scene');
  assert.equal(body.input[0].params.n, 1);
  assert.equal(body.input[0].params.resolution, '1k');
});

test('LLM non-streaming APIs post to the expected paths', async (t) => {
  const paths = [];
  const client = await testClient(t, async (req, res) => {
    paths.push(req.url);
    const body = req.method === 'POST' ? await readJSON(req) : undefined;
    if (req.url === '/chat/completions') {
      assert.equal(req.headers['x-model'], 'gpt-4o-mini');
      assert.equal(body.model, undefined);
      writeJSON(res, 200, { id: 'chat_123', choices: [{ message: { role: 'assistant', content: 'hello' } }] });
    } else if (req.url === '/v1/messages') {
      assert.equal(req.headers['x-model'], 'claude-3-5-sonnet');
      assert.equal(body.model, undefined);
      assert.equal(body.max_tokens, 32);
      writeJSON(res, 200, { id: 'msg_123', role: 'assistant', content: [{ type: 'text', text: 'hello from claude' }] });
    } else if (req.url === '/responses') {
      assert.equal(req.headers['x-model'], 'gpt-4.1-mini');
      assert.equal(body.model, undefined);
      assert.equal(body.input, 'hello');
      writeJSON(res, 200, { id: 'resp_123', status: 'completed', output: [] });
    } else if (req.url === '/rerank') {
      assert.equal(req.headers['x-model'], 'qwen3-rerank');
      assert.equal(body.model, undefined);
      assert.equal(body.query, 'mountain lake');
      writeJSON(res, 200, { id: 'rerank_123', results: [{ index: 1, relevance_score: 0.98 }] });
    } else if (req.url === '/v1/embeddings') {
      assert.equal(req.headers['x-model'], 'text-embedding-3-small');
      assert.equal(body.model, undefined);
      assert.equal(body.input, 'hello');
      writeJSON(res, 200, { object: 'list', data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }] });
    } else {
      assert.equal(req.url, '/v1/models');
      writeJSON(res, 200, { object: 'list', data: [{ id: 'gpt-4o-mini', object: 'model' }] });
    }
  });

  assert.equal(decode(await client.llm.chatCompletions({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] })).id, 'chat_123');
  assert.equal(decode(await client.llm.messages({ model: 'claude-3-5-sonnet', messages: [], max_tokens: 32 })).id, 'msg_123');
  assert.equal(decode(await client.llm.responses({ model: 'gpt-4.1-mini', input: 'hello' })).id, 'resp_123');
  assert.equal(decode(await client.llm.rerank({ model: 'qwen3-rerank', query: 'mountain lake', documents: [] })).id, 'rerank_123');
  assert.equal(decode(await client.llm.embeddings({ model: 'text-embedding-3-small', input: 'hello' })).object, 'list');
  assert.equal(decode(await client.LLM.ListModels()).data[0].id, 'gpt-4o-mini');
  assert.deepEqual(paths, ['/chat/completions', '/v1/messages', '/responses', '/rerank', '/v1/embeddings', '/v1/models']);
});

test('LLM request headers and error classification match Go SDK behavior', async (t) => {
  const client = await testClient(t, async (req, res) => {
    assert.equal(req.headers['x-trace-id'], 'trace-123');
    assert.equal(req.headers['x-tenant-id'], 'tenant-a');
    writeJSON(res, 401, { error: { message: 'invalid api key' } });
  });

  await assert.rejects(
    client.llm.chatCompletions(
      { model: 'gpt-4o-mini', messages: [] },
      withHeader('X-Trace-Id', 'trace-123'),
      withHeaders({ 'X-Tenant-Id': 'tenant-a' }),
    ),
    (error) => error instanceof SeaArtError && error.kind === ErrAuth && error.message === 'invalid api key',
  );
});

test('LLM rejects conflicting model and X-Model values', async (t) => {
  const client = await testClient(t, async () => assert.fail('request should not be sent'));

  await assert.rejects(
    client.llm.chatCompletions(
      { model: 'gpt-4o-mini', messages: [] },
      withHeader('X-Model', 'another-model'),
    ),
    /model and X-Model cannot both be set/,
  );
});

test('LLM non-streaming methods reject stream=true payloads', async (t) => {
  const client = await testClient(t, async () => assert.fail('request should not be sent'));

  await assert.rejects(
    client.llm.chatCompletions({ model: 'gpt-4o-mini', messages: [], stream: true }),
    /ChatCompletionsStream/,
  );
  await assert.rejects(
    client.llm.messages({ model: 'claude-3-5-sonnet', messages: [], max_tokens: 32, stream: true }),
    /MessagesStream/,
  );
  await assert.rejects(
    client.llm.responses({ model: 'gpt-4.1-mini', input: 'hello', stream: true }),
    /ResponsesStream/,
  );
});

test('LLM chat completions stream parses SSE events', async (t) => {
  const client = await testClient(t, async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/chat/completions');
    assert.equal(req.headers['x-model'], 'gpt-4o-mini');
    const body = await readJSON(req);
    assert.equal(body.model, undefined);
    assert.equal(body.stream, true);

    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('event: message\n');
    res.write('data: {"id":"chatcmpl_1","choices":[{"delta":{"role":"assistant","content":"hello"}}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });

  const events = [];
  for await (const event of client.llm.chatCompletionsStream({ model: 'gpt-4o-mini', messages: [] })) {
    events.push(event);
  }

  assert.equal(events[0].event, 'message');
  assert.equal(decode(events[0].data).choices[0].delta.content, 'hello');
  assert.equal(events[1].done, true);
});

test('LLM messages and responses stream text assemblers work with parsed chunks', async (t) => {
  const client = await testClient(t, async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (req.url === '/v1/messages') {
      res.write('data: {"type":"message_start","message":{"id":"msg_1","role":"assistant"}}\n\n');
      res.write('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n');
      res.write('data: {"type":"message_stop"}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    assert.equal(req.url, '/responses');
    res.write('data: {"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}\n\n');
    res.write('data: {"type":"response.output_text.delta","delta":"hello"}\n\n');
    res.write('data: {"type":"response.output_text.delta","delta":" world"}\n\n');
    res.write('data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"total_tokens":9}}}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });

  const messageText = new MessagesStreamTextAssembler();
  for await (const event of client.llm.messagesStream({ model: 'claude-3-5-sonnet', messages: [], max_tokens: 32 })) {
    if (!event.done) {
      messageText.add(decode(event.data));
    }
  }
  assert.equal(messageText.text(), 'hello');

  const responseText = new ResponsesStreamTextAssembler();
  let completed;
  for await (const event of client.llm.responsesStream({ model: 'gpt-4.1-mini', input: 'hello' })) {
    if (!event.done) {
      const chunk = decode(event.data);
      if (chunk.type === 'response.completed') {
        completed = chunk;
      }
      responseText.add(chunk);
    }
  }
  assert.equal(responseText.text(), 'hello world');
  assert.equal(completed.response.usage.total_tokens, 9);
});

test('Passthrough returns raw status, headers, and body for all HTTP statuses', async (t) => {
  const client = await passthroughClient(t, async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/kling/v1/videos/text2video');
    assert.equal(req.headers.authorization, 'Bearer test-key');
    assert.equal(req.headers['x-trace-id'], 'trace-123');
    const body = await readJSON(req);
    assert.equal(body.model_name, 'kling-v1');
    res.writeHead(202, { 'Content-Type': 'application/json', 'X-Task-Route': 'passthrough' });
    res.end(JSON.stringify({ data: { task_id: 'task_123' } }));
  });

  const response = await client.passthrough.post('/kling/v1/videos/text2video', { model_name: 'kling-v1' }, withHeader('X-Trace-Id', 'trace-123'));
  assert.equal(response.statusCode, 202);
  assert.equal(response.headers.get('x-task-route'), 'passthrough');
  assert.equal(response.json().data.task_id, 'task_123');
});

test('Passthrough sends raw body as-is and rejects absolute URLs', async (t) => {
  const rawBody = new TextEncoder().encode('{"contents":[{"parts":[{"text":"paint a cat"}]}]}');
  const client = await passthroughClient(t, async (req, res) => {
    assert.equal(req.url, '/google/v1beta/models/gemini-2.5-flash-image:generateContent');
    const body = await readText(req);
    assert.equal(body, new TextDecoder().decode(rawBody));
    writeJSON(res, 400, { error: { message: 'bad request' } });
  });

  const response = await client.passthrough.requestRaw('POST', 'google/v1beta/models/gemini-2.5-flash-image:generateContent', rawBody);
  assert.equal(response.statusCode, 400);
  assert.match(response.text(), /bad request/);
  await assert.rejects(client.passthrough.get('https://example.com/kling/v1/videos/text2video'), /relative/);
});

async function testClient(t, handler) {
  const url = await listen(t, handler);
  return new Client({
    apiKey: 'test-key',
    modelBaseURL: url,
    llmBaseURL: url,
    timeout: 5000,
  });
}

async function passthroughClient(t, handler) {
  const url = await listen(t, handler);
  return new Client({
    apiKey: 'test-key',
    passthroughBaseURL: url,
    timeout: 5000,
  });
}

async function listen(t, handler) {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(error.stack);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function writeJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJSON(req) {
  return JSON.parse(await readText(req));
}

async function readText(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
