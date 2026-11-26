import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const source = await readFile(new URL('../recorder.js', import.meta.url), 'utf8').catch(() => '/* recorder not implemented */');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.CHROME_CHANNEL || 'chrome' }); });
after(async () => { await browser?.close(); });

async function fixture(t, options = {}) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('https://meet.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Meet fixture</title>' }));
  await page.goto('https://meet.google.com/abc-defg-hij');
  await page.evaluate(options => {
    window.messages = []; window.states = []; window.streams = []; window.displayCalls = 0;
    const track = kind => {
      const value = new EventTarget();
      Object.assign(value, { kind, readyState: 'live', stop() { this.readyState = 'ended'; } });
      return value;
    };
    window.makeStream = (audio = true, video = true) => {
      const tracks = [...(audio ? [track('audio')] : []), ...(video ? [track('video')] : [])];
      const stream = { getTracks: () => tracks, getAudioTracks: () => tracks.filter(t => t.kind === 'audio'), getVideoTracks: () => tracks.filter(t => t.kind === 'video') };
      streams.push(stream); return stream;
    };
    window.displayStream = makeStream(!options.noAudio, false);
    window.microphoneStream = makeStream(true, false);
    const mediaDevices = {
      getDisplayMedia() { throw new Error('Screen sharing must never be requested'); },
      getUserMedia(constraints) {
        if (constraints.audio?.mandatory) {
          window.displayCalls++; window.displayOptions = constraints;
          if (options.cancel) return Promise.reject(new DOMException('Not invoked', 'NotAllowedError'));
          if (options.pending) return new Promise(resolve => { window.resolvePicker = () => resolve(displayStream); });
          return Promise.resolve(displayStream);
        }
        if (options.pendingMic) return new Promise(resolve => { window.resolveMicrophone = () => resolve(microphoneStream); });
        return options.micDenied ? Promise.reject(new DOMException('Denied', 'NotAllowedError')) : Promise.resolve(microphoneStream);
      },
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    window.MediaStream = class { constructor(tracks) { this.tracks = tracks; } getTracks() { return this.tracks; } getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); } getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); } };
    window.contexts = []; window.connections = [];
    window.AudioContext = class {
      state = 'running';
      constructor() { contexts.push(this); this.destination = { kind: 'speakers' }; }
      createMediaStreamSource(stream) { return { connect(target) { connections.push([stream.getAudioTracks()[0] === displayStream.getAudioTracks()[0] ? 'tab' : 'mic', target.kind || 'mixed']); }, disconnect() {} }; }
      createMediaStreamDestination() { return { stream: new MediaStream([track('audio')]) }; }
      async close() { this.state = 'closed'; }
      async resume() {}
    };
    window.MediaRecorder = class {
      static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
      state = 'inactive';
      constructor(stream, init) { window.encodedStream = stream; this.mimeType = init.mimeType; window.mediaRecorder = this; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['final'], { type: this.mimeType }) }); this.onstop?.(); }
      emit(data) { this.ondataavailable?.({ data: new Blob([data], { type: this.mimeType }) }); }
    };
    window.options = options;
  }, options);
  await page.addScriptTag({ content: source });
  assert.equal(await page.evaluate(() => typeof window.MeetingRecorder?.create), 'function', 'recorder namespace must be implemented');
  await page.evaluate(() => {
    window.recorder = MeetingRecorder.create({
      send: async message => {
        messages.push(message);
        if (message.type === 'recording.begin' && options.pendingBegin) await new Promise(resolve => { window.resolveBegin = resolve; });
        if (message.type === 'recording.chunk' && options.failChunk) return { ok: false, error: 'Disk full' };
        if (message.type === 'recording.chunk' && options.delayChunk) await new Promise(resolve => setTimeout(resolve, 40));
        return { ok: true };
      },
      onState: value => states.push(value),
    });
    window.metadata = { streamId: 'tab-stream-id', meetingUrl: 'https://meet.google.com/abc-defg-hij', title: 'Weekly planning' };
  });
  return page;
}

test('recording consumes audio-only tab stream ID, restores only tab playback, and persists final chunk before finish', async t => {
  const page = await fixture(t, { delayChunk: true });
  const result = await page.evaluate(async () => {
    const pending = recorder.start(metadata);
    const synchronousCalls = displayCalls;
    await pending;
    mediaRecorder.emit('first'); mediaRecorder.emit('second');
    await recorder.stop();
    return { synchronousCalls, messages, state: recorder.getState(), audio: encodedStream.getAudioTracks().length, video: encodedStream.getVideoTracks().length,
      stopped: streams.every(s => s.getTracks().every(t => t.readyState === 'ended')), contextsClosed: contexts.every(c => c.state === 'closed'), constraints: displayOptions, connections };
  });
  assert.equal(result.synchronousCalls, 1);
  assert.deepEqual(result.constraints, { audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'tab-stream-id' } }, video: false });
  assert.deepEqual(result.connections, [['tab', 'mixed'], ['tab', 'speakers'], ['mic', 'mixed']]);
  assert.equal(result.audio, 1); assert.equal(result.video, 0);
  assert.deepEqual(result.messages.map(m => m.type), ['recording.begin', 'recording.chunk', 'recording.chunk', 'recording.chunk', 'recording.finish']);
  assert.deepEqual(result.messages.filter(m => m.type === 'recording.chunk').map(m => [m.sequence, atob(m.data)]), [[0, 'first'], [1, 'second'], [2, 'final']]);
  assert.equal(result.state.status, 'saved');
  assert.equal(result.stopped, true); assert.equal(result.contextsClosed, true);
});

test('tab acquisition failure, missing tab sound and denied microphone never leave capture tracks running', async t => {
  for (const options of [{ cancel: true }, { noAudio: true }, { micDenied: true }]) {
    const page = await fixture(t, options);
    const result = await page.evaluate(async () => {
      await recorder.start(metadata);
      return { state: recorder.getState(), messages, displayStopped: displayStream.getTracks().every(t => t.readyState === 'ended') };
    });
    assert.equal(result.state.status, 'error');
    assert.deepEqual(result.messages, []);
    if (!options.cancel) assert.equal(result.displayStopped, true);
    if (!options.cancel) assert.ok(result.state.error);
    if (options.micDenied) assert.equal(result.state.needsMicrophone, true);
  }
});

test('duplicate starts share one tab acquisition and stop during pending acquisition releases the returned stream', async t => {
  const page = await fixture(t, { pending: true });
  const result = await page.evaluate(async () => {
    const first = recorder.start(metadata), second = recorder.start(metadata);
    await recorder.stop();
    resolvePicker();
    await Promise.all([first, second]);
    return { displayCalls, messages, state: recorder.getState(), stopped: displayStream.getTracks().every(t => t.readyState === 'ended') };
  });
  assert.equal(result.displayCalls, 1);
  assert.deepEqual(result.messages, []);
  assert.equal(result.state.status, 'idle'); assert.equal(result.stopped, true);
});

test('stop during the microphone permission prompt immediately releases the shared tab', async t => {
  const page = await fixture(t, { pendingMic: true });
  await page.evaluate(() => { window.starting = recorder.start(metadata); });
  await page.waitForFunction(() => typeof resolveMicrophone === 'function');
  const result = await page.evaluate(async () => {
    await recorder.stop();
    const displayStoppedBeforeMicReply = displayStream.getTracks().every(t => t.readyState === 'ended');
    resolveMicrophone(); await starting;
    return { displayStoppedBeforeMicReply, allStopped: streams.every(s => s.getTracks().every(t => t.readyState === 'ended')), messages };
  });
  assert.equal(result.displayStoppedBeforeMicReply, true);
  assert.equal(result.allStopped, true); assert.deepEqual(result.messages, []);
});

test('sharing stopped while microphone permission is pending cannot later start a silent recording', async t => {
  const page = await fixture(t, { pendingMic: true });
  await page.evaluate(() => { window.starting = recorder.start(metadata); });
  await page.waitForFunction(() => typeof resolveMicrophone === 'function');
  const result = await page.evaluate(async () => {
    const track = displayStream.getAudioTracks()[0]; track.stop(); track.dispatchEvent(new Event('ended'));
    resolveMicrophone(); await starting;
    return { state: recorder.getState(), messages, stopped: streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) };
  });
  assert.equal(result.state.status, 'error');
  assert.ok(result.state.error); assert.equal(result.stopped, true);
  assert.deepEqual(result.messages, []);
});

test('tab or microphone ending while recording.begin is pending finalizes an interrupted record', async t => {
  for (const source of ['displayStream', 'microphoneStream']) {
    const page = await fixture(t, { pendingBegin: true });
    await page.evaluate(() => { window.starting = recorder.start(metadata); });
    await page.waitForFunction(() => typeof resolveBegin === 'function');
    const result = await page.evaluate(async source => {
      const track = window[source].getTracks()[0]; track.stop(); track.dispatchEvent(new Event('ended'));
      resolveBegin(); await starting;
      return { state: recorder.getState(), messages, stopped: streams.every(s => s.getTracks().every(t => t.readyState === 'ended')), encodedState: mediaRecorder.state };
    }, source);
    assert.equal(result.state.status, 'error');
    assert.equal(result.encodedState, 'inactive');
    assert.equal(result.stopped, true);
    assert.deepEqual(result.messages.map(m => m.type), ['recording.begin', 'recording.finish']);
    assert.ok(result.messages.at(-1).error);
  }
});

test('persistence failure preserves error and finalizes as interrupted after releasing devices', async t => {
  const page = await fixture(t, { failChunk: true });
  await page.evaluate(async () => { await recorder.start(metadata); mediaRecorder.emit('first'); });
  await page.waitForFunction(() => recorder.getState().status === 'error');
  const result = await page.evaluate(() => ({ state: recorder.getState(), messages, stopped: streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) }));
  assert.match(result.state.error, /Disk full/);
  assert.equal(result.stopped, true);
  assert.equal(result.messages.at(-1).type, 'recording.finish');
  assert.ok(result.messages.at(-1).error);
});

test('ending the shared tab stops capture and finalizes once', async t => {
  const page = await fixture(t);
  await page.evaluate(async () => { await recorder.start(metadata); displayStream.getAudioTracks()[0].dispatchEvent(new Event('ended')); });
  await page.waitForFunction(() => recorder.getState().status === 'saved');
  const result = await page.evaluate(() => ({ messages, stopped: streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) }));
  assert.equal(result.messages.filter(m => m.type === 'recording.finish').length, 1);
  assert.equal(result.stopped, true);
});

test('a disconnected microphone stops visibly instead of silently recording only the other participants', async t => {
  const page = await fixture(t);
  await page.evaluate(async () => { await recorder.start(metadata); microphoneStream.getAudioTracks()[0].dispatchEvent(new Event('ended')); });
  await page.waitForFunction(() => recorder.getState().status === 'error');
  const result = await page.evaluate(() => ({ state: recorder.getState(), messages }));
  assert.match(result.state.error, /Micro/);
  assert.ok(result.messages.at(-1).error);
});

test('a slow persistent store bounds buffered audio and releases capture before reporting interruption', async t => {
  const page = await fixture(t, { delayChunk: true });
  await page.evaluate(async () => {
    await recorder.start(metadata);
    for (let index = 0; index < 12; index++) mediaRecorder.emit(`audio-${index}`);
  });
  await page.waitForFunction(() => recorder.getState().status === 'error');
  const result = await page.evaluate(() => ({ state: recorder.getState(), messages, stopped: streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) }));
  assert.match(result.state.error, /quá chậm/);
  assert.ok(result.messages.filter(m => m.type === 'recording.chunk').length <= 8);
  assert.ok(result.messages.at(-1).error);
  assert.equal(result.stopped, true);
});

test('real WebAudio and MediaRecorder produce decodable audio-only WebM', async t => {
  const page = await browser.newPage(); t.after(() => page.close());
  await page.route('https://meet.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Meet fixture</title>' }));
  await page.goto('https://meet.google.com/abc-defg-hij');
  await page.evaluate(() => {
    const context = new AudioContext();
    window.fixtureContext = context;
    const destination = context.createMediaStreamDestination();
    const oscillator = context.createOscillator(); oscillator.frequency.value = 440; oscillator.connect(destination); oscillator.start();
    window.fixtureOscillator = oscillator;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getDisplayMedia: () => { throw Error('Screen sharing forbidden'); },
      getUserMedia: async constraints => constraints.audio?.mandatory ? destination.stream : destination.stream.clone(),
    } });
    window.messages = [];
  });
  await page.addScriptTag({ content: source });
  assert.equal(await page.evaluate(() => typeof window.MeetingRecorder?.create), 'function');
  await page.evaluate(async () => {
    window.recorder = MeetingRecorder.create({ send: async message => { messages.push(message); return { ok: true }; }, onState() {} });
    await recorder.start({ streamId: 'synthetic-tab', meetingUrl: 'https://meet.google.com/abc-defg-hij', title: 'Synthetic capture' });
  });
  await page.waitForTimeout(1200);
  const result = await page.evaluate(async () => {
    await recorder.stop();
    const chunks = messages.filter(m => m.type === 'recording.chunk').map(m => Uint8Array.from(atob(m.data), c => c.charCodeAt(0)));
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const audio = document.createElement('audio'); audio.src = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => { audio.onloadeddata = resolve; audio.onerror = () => reject(new Error('WebM decoding failed')); audio.load(); });
    const decoded = await fixtureContext.decodeAudioData(await blob.arrayBuffer());
    const peak = Math.max(...decoded.getChannelData(0).subarray(0, 32768).map(Math.abs));
    fixtureOscillator.stop(); await fixtureContext.close();
    return { size: blob.size, state: recorder.getState(), mimeType: messages[0].mimeType, readyState: audio.readyState, channels: decoded.numberOfChannels, peak };
  });
  assert.ok(result.size > 1000); assert.equal(result.state.status, 'saved');
  assert.match(result.mimeType, /^audio\/webm/); assert.ok(result.readyState >= 2);
  assert.ok(result.peak > 0.01, 'recorded samples must contain the synthetic signal');
});
