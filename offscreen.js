import { createRecordingStore } from './recording-store.js';

const ROOM = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const ACTIVE = new Set(['starting', 'recording', 'saving']);
const TYPES = new Set(['recording.offscreen.start', 'recording.offscreen.stop', 'recording.offscreen.status', 'recording.offscreen.permissions']);

/** Owns capture and persistence independently of the service worker's lifetime. */
export function createOffscreenRecorder({ chrome, store, recorderFactory, permissions = navigator.permissions }) {
  let metadata = null, starting = false, canceled = false, overrideState = null;
  const snapshot = () => ({
    ok: true,
    state: overrideState || recorder.getState(),
    captureId: metadata?.captureId ?? null,
    tabId: metadata?.tabId ?? null,
    meetingUrl: metadata?.meetingUrl ?? null,
    active: starting || ACTIVE.has(recorder.getState().status),
  });
  function broadcast() {
    const { ok, ...value } = snapshot();
    Promise.resolve(chrome.runtime.sendMessage({ target: 'background', type: 'recording.state', ...value })).catch(() => {});
  }
  const recorder = recorderFactory({
    onState() { overrideState = null; broadcast(); },
    async send(message) {
      if (!metadata) throw Error('Recording context is missing');
      if (message.type === 'recording.begin') {
        // Any stale row is from an interrupted prior document, not a live capture.
        await store.interruptTab(metadata.tabId);
        await store.begin({
          id: message.id, tabId: metadata.tabId, documentId: metadata.documentId ?? null,
          meetingUrl: metadata.meetingUrl, title: metadata.title,
          startedAt: message.startedAt, mimeType: message.mimeType,
        });
      } else if (message.type === 'recording.chunk') {
        const bytes = Uint8Array.from(atob(message.data), character => character.charCodeAt(0));
        await store.append(message.id, message.sequence, new Blob([bytes], { type: 'audio/webm' }));
      } else if (message.type === 'recording.finish') {
        await store.finish(message.id, {
          endedAt: message.endedAt,
          status: message.error ? 'interrupted' : 'pending-upload',
          ...(message.error ? { error: message.error } : {}),
        });
      } else throw Error('Unknown recording storage operation');
      return { ok: true };
    },
  });
  function validateSender(sender) {
    if (sender.id !== chrome.runtime.id || sender.tab
      || sender.url && sender.url !== chrome.runtime.getURL('background.js')) throw Error('Untrusted offscreen sender');
  }
  function validateMetadata(value) {
    if (!value || !Number.isInteger(value.tabId) || value.tabId < 0
      || typeof value.captureId !== 'string' || !value.captureId || value.captureId.length > 200
      || typeof value.streamId !== 'string' || !value.streamId || value.streamId.length > 4096
      || !ROOM.test(value.meetingUrl) || typeof value.title !== 'string') throw Error('Invalid capture metadata');
  }
  return {
    snapshot,
    async handle(message, sender) {
      if (message?.target !== 'offscreen' || !TYPES.has(message.type)) return;
      validateSender(sender);
      if (message.type === 'recording.offscreen.permissions') {
        const permission = await permissions.query({ name: 'microphone' });
        return { ok: true, microphone: permission.state };
      }
      if (message.type === 'recording.offscreen.status') return snapshot();
      if (message.type === 'recording.offscreen.stop') {
        if (starting) canceled = true;
        await recorder.stop();
        return snapshot();
      }
      validateMetadata(message.metadata);
      if (snapshot().active) throw Error('A recording is already active');
      metadata = { ...message.metadata, title: message.metadata.title.trim().slice(0, 200) || 'Cuộc họp' };
      overrideState = null;
      starting = true;
      canceled = false;
      try {
        // A trusted visible helper can hand off a live permission grant before
        // closing. getUserMedia below remains the final permission authority.
        const permission = metadata.microphoneAuthorized ? { state: 'granted' } : await permissions.query({ name: 'microphone' });
        if (canceled) {
          overrideState = { status: 'idle' };
        } else if (permission.state !== 'granted') {
          overrideState = { status: 'error', error: 'Hãy cấp quyền micro trong July rồi quay lại tab Meet.', needsMicrophone: true };
          throw Error(overrideState.error);
        } else await recorder.start(metadata);
      } catch (error) {
        overrideState ||= { status: 'error', error: error.message || 'Không thể bắt đầu ghi âm.' };
        throw error;
      } finally {
        starting = false;
        broadcast();
      }
      return snapshot();
    },
  };
}

if (globalThis.chrome?.runtime?.id && globalThis.MeetingRecorder) {
  const router = createOffscreenRecorder({ chrome, store: createRecordingStore(), recorderFactory: options => MeetingRecorder.create(options) });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.target !== 'offscreen' || !TYPES.has(message.type)) return;
    router.handle(message, sender).then(respond, error => respond({ ...router.snapshot(), ok: false, error: error.message }));
    return true;
  });
}
