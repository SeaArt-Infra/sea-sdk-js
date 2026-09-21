import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Client,
  ErrGeneral,
  ErrQuota,
  ErrTaskFailed,
  ErrTimeout,
  SeaArtError,
  TaskStreamEvent,
  withHeader,
} from '../src/index.js';

const encoder = new TextEncoder();

function sseResponse(frames, status = 200) {
  const stream = new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function clientWithFetch(fetchImpl) {
  return new Client({ apiKey: 'test-key', baseURL: 'https://gateway.example.com', fetch: fetchImpl });
}

test('createSync waits for the final result', async () => {
  let request;
  const client = clientWithFetch(async (url, options) => {
    request = { url: String(url), options };
    return jsonResponse({
      id: 'task_sync_1',
      status: 'completed',
      model: 'microsoft_gpt_image_2_5_flare',
      output: [{ content: [{ type: 'image', url: 'https://cdn.example.com/out.webp' }] }],
      usage: { cost: '0.0065', discount: 1 },
    });
  });

  const task = await client.modal.createSync({
    model: 'microsoft_gpt_image_2_5_flare',
    input: [{ params: { prompt: 'a dog is running' } }],
  });

  assert.equal(request.url, 'https://gateway.example.com/model/v1/generation/sync');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.get('Accept'), 'application/json');
  assert.equal(request.options.headers.get('X-Model'), 'microsoft_gpt_image_2_5_flare');
  assert.equal(task.id, 'task_sync_1');
  assert.equal(task.status, 'completed');
  assert.equal(task.output[0].content[0].url, 'https://cdn.example.com/out.webp');
  assert.equal(task.usage.cost, '0.0065');
});

test('createSync reports a failed task as task_failed', async () => {
  const client = clientWithFetch(async () => jsonResponse({
    id: 'task_sync_failed',
    status: 'failed',
    error: { code: 110001, message: 'vendor rejected' },
  }));

  await assert.rejects(
    () => client.modal.createSync({ model: 'm' }),
    (error) => {
      assert.ok(error instanceof SeaArtError);
      assert.equal(error.kind, ErrTaskFailed);
      assert.equal(error.taskID, 'task_sync_failed');
      assert.match(error.message, /vendor rejected/);
      return true;
    },
  );
});

test('createSync keeps the task id when the gateway stops waiting', async () => {
  const client = clientWithFetch(async () => jsonResponse({
    id: 'task_slow',
    status: 'in_progress',
    error: { code: 'SYNC_TIMEOUT', message: 'waited 15m0s, still running' },
  }, 504));

  await assert.rejects(
    () => client.modal.createSync({ model: 'm' }),
    (error) => {
      assert.equal(error.kind, ErrTimeout);
      assert.equal(error.taskID, 'task_slow');
      return true;
    },
  );
});

test('createStream yields chunks then the final result', async () => {
  let request;
  const client = clientWithFetch(async (url, options) => {
    request = { url: String(url), options };
    return sseResponse([
      'event: output\ndata: {"id":"task_s","model":"m","status":"in_progress","output":[{"content":[{"type":"audio","url":"https://cdn.example.com/0.wav","chunk_index":0}]}],"cursor":1}\n\n',
      ': keepalive\n\n',
      'event: output\ndata: {"id":"task_s","model":"m","status":"in_progress","output":[{"content":[{"type":"audio","url":"https://cdn.example.com/1.wav","chunk_index":1}]}],"cursor":3}\n\n',
      'event: done\ndata: {"id":"task_s","status":"completed","model":"m","output":[{"content":[{"type":"audio","url":"https://cdn.example.com/full.wav"}]}],"usage":{"cost":"0.0017"}}\n\n',
    ]);
  });

  const events = [];
  for await (const event of client.modal.createStream({ model: 'm' })) {
    events.push(event);
  }

  assert.equal(request.options.headers.get('Accept'), 'text/event-stream');
  assert.equal(events.length, 3, 'keepalive comments must not produce events');

  const first = events[0];
  assert.ok(first instanceof TaskStreamEvent);
  assert.equal(first.event, 'output');
  assert.equal(first.taskID, 'task_s');
  assert.equal(first.cursor, 1);
  assert.equal(first.done, false);
  assert.equal(first.status, 'in_progress', 'output frames must expose the frame status');
  assert.deepEqual(first.urls(), ['https://cdn.example.com/0.wav']);
  // the chunk payload is passed through as sent by the gateway
  assert.equal(first.chunks[0].content[0].chunk_index, 0);

  assert.equal(events[1].cursor, 3, 'cursor jumps by the number of chunks in the frame');
  assert.deepEqual(events[1].urls(), ['https://cdn.example.com/1.wav']);

  const last = events[2];
  assert.equal(last.event, 'done');
  assert.equal(last.done, true);
  assert.equal(last.task.status, 'completed');
  assert.deepEqual(last.task.output[0].content[0].url, 'https://cdn.example.com/full.wav');
  assert.equal(last.task.usage.cost, '0.0017');
});

test('createStream reports an error frame as terminal', async () => {
  const client = clientWithFetch(async () => sseResponse([
    'event: error\ndata: {"id":"task_s","status":"in_progress","error":{"code":"SYNC_TIMEOUT","message":"waited too long"}}\n\n',
  ]));

  const events = [];
  for await (const event of client.modal.createStream({ model: 'm' })) {
    events.push(event);
  }

  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'error');
  assert.equal(events[0].errorCode, 'SYNC_TIMEOUT');
  assert.equal(events[0].errorMessage, 'waited too long');
  assert.equal(events[0].done, true);
});

test('createStream surfaces HTTP errors raised before streaming', async () => {
  const client = clientWithFetch(async () => jsonResponse({ error: { code: 1002, message: 'rate limited' } }, 429));

  await assert.rejects(
    () => client.modal.createStream({ model: 'm' }).next(),
    (error) => {
      assert.equal(error.kind, ErrQuota);
      assert.equal(error.status, 429);
      return true;
    },
  );
});

test('subscribe resumes from a cursor', async () => {
  let request;
  const client = clientWithFetch(async (url, options) => {
    request = { url: String(url), options };
    return sseResponse([
      'event: output\ndata: {"id":"task_resume","status":"in_progress","output":[{"content":[{"type":"audio","url":"https://cdn.example.com/3.wav","chunk_index":3}]}],"cursor":4}\n\n',
      'event: done\ndata: {"id":"task_resume","status":"completed","output":[]}\n\n',
    ]);
  });

  const events = [];
  for await (const event of client.modal.subscribe('task_resume', 3)) {
    events.push(event);
  }

  assert.equal(request.url, 'https://gateway.example.com/model/v1/generation/task/task_resume/stream?cursor=3');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.get('Accept'), 'text/event-stream');
  assert.equal(events[0].cursor, 4);
  assert.deepEqual(events[0].urls(), ['https://cdn.example.com/3.wav']);
  assert.equal(events[1].task.id, 'task_resume');
});

test('subscribe omits cursor 0 and validates the task id', async () => {
  let request;
  const client = clientWithFetch(async (url) => {
    request = { url: String(url) };
    return sseResponse(['event: done\ndata: {"id":"task_zero","status":"completed","output":[]}\n\n']);
  });

  for await (const _ of client.modal.subscribe('task_zero')) {
    // consume
  }
  assert.equal(request.url, 'https://gateway.example.com/model/v1/generation/task/task_zero/stream');

  await assert.rejects(
    () => client.modal.subscribe('  ').next(),
    (error) => error instanceof SeaArtError && error.kind === ErrGeneral,
  );
});

test('task.stream() subscribes to its own task', async () => {
  const paths = [];
  const client = clientWithFetch(async (url) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path === '/model/v1/generation') {
      return jsonResponse({ id: 'task_bound', status: 'in_progress', model: 'm' });
    }
    return sseResponse(['event: done\ndata: {"id":"task_bound","status":"completed","output":[]}\n\n']);
  });

  const task = await client.modal.create({ model: 'm' });
  const events = [];
  for await (const event of task.stream()) {
    events.push(event);
  }

  assert.deepEqual(paths, ['/model/v1/generation', '/model/v1/generation/task/task_bound/stream']);
  assert.equal(events[0].done, true);
  assert.equal(events[0].task.id, 'task_bound');
});

test('createStream fails when the stream ends before a terminal event', async () => {
  const client = clientWithFetch(async () => sseResponse([
    // chunks arrive, then the connection is cut: no done/error frame
    'event: output\ndata: {"id":"task_s","status":"in_progress","output":[{"content":[{"type":"audio","url":"https://cdn.example.com/0.wav"}]}],"cursor":1}\n\n',
  ]));

  const seen = [];
  await assert.rejects(
    async () => {
      for await (const event of client.modal.createStream({ model: 'm' })) {
        seen.push(event);
      }
    },
    (error) => {
      assert.ok(error instanceof SeaArtError);
      assert.equal(error.kind, 'network');
      assert.match(error.message, /terminal event/);
      return true;
    },
  );
  assert.equal(seen.length, 1, 'the chunks that did arrive are still delivered');
});

test('createStream reads error_message when the gateway reports it that way', async () => {
  const client = clientWithFetch(async () => sseResponse([
    'event: error\ndata: {"id":"task_s","status":"in_progress","error":{"code":"SYNC_TIMEOUT","error_message":"still running"}}\n\n',
  ]));

  const events = [];
  for await (const event of client.modal.createStream({ model: 'm' })) {
    events.push(event);
  }

  assert.equal(events[0].errorCode, 'SYNC_TIMEOUT');
  assert.equal(events[0].errorMessage, 'still running');
  assert.equal(events[0].status, 'in_progress');
});

test('createStream surfaces malformed frames instead of dropping them', async () => {
  const client = clientWithFetch(async () => sseResponse([
    'event: output\ndata: {not json\n\n',
    'event: done\ndata: {"id":"task_bad","status":"completed","output":[]}\n\n',
  ]));

  const events = [];
  for await (const event of client.modal.createStream({ model: 'm' })) {
    events.push(event);
  }

  const malformed = events.find((event) => event.error);
  assert.ok(malformed, 'the malformed frame must be surfaced');
  assert.match(malformed.error.message, /decode stream frame/);

  const terminal = events.find((event) => event.done);
  assert.equal(terminal.task.status, 'completed', 'the stream continues after a malformed frame');
});
