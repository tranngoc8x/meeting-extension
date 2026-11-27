// Classic script loaded by the extension's offscreen document. The service worker
// obtains the tab stream ID after an explicit extension invocation.
(() => {
  const MAX_PENDING_CHUNKS = 8;
  function create({ send, onState = () => {} }) {
    let state = { status: 'idle' }, current = null;
    const publish = value => { state = value; onState({ ...state }); };
    async function request(message) {
      const result = await send(message);
      if (!result?.ok) throw new Error(result?.error || 'Không thể lưu bản ghi trên máy.');
      return result;
    }
    function cleanup(session) {
      for (const [track, listener] of session.listeners) track.removeEventListener('ended', listener);
      session.listeners = [];
      for (const stream of [session.display, session.mic, session.output]) {
        stream?.getTracks().forEach(track => track.stop());
      }
      session.sources.forEach(source => source.disconnect());
      session.sources = [];
      return session.context?.close().catch(() => {});
    }
    async function finish(session) {
      if (session.finishing) return;
      session.finishing = true;
      await cleanup(session);
      await session.queue;
      if (session.persisted) {
        try {
          await request({ type: 'recording.finish', id: session.id, endedAt: new Date().toISOString(),
            ...(session.failure ? { error: session.failure } : {}) });
        } catch (error) { session.failure ||= error.message; }
      }
      if (current === session) {
        current = null;
        publish(session.failure
          ? { status: 'error', id: session.id, error: session.failure, ...(session.needsMicrophone ? { needsMicrophone: true } : {}) }
          : { status: session.persisted ? 'saved' : 'idle', id: session.persisted ? session.id : undefined });
      }
      session.resolveStopped?.();
    }
    function fail(session, error) {
      session.failure ||= error?.message || 'Không thể tiếp tục ghi âm.';
      void stop();
    }
    function connectMicrophone(session) {
      const source = session.context.createMediaStreamSource(new MediaStream(session.mic.getAudioTracks()));
      source.connect(session.destination);
      session.micSource = source;
      session.sources.push(source);
    }
    async function recoverMicrophone(session) {
      if (session.recovering || session.canceled || session.finishing) return;
      session.recovering = true;
      for (let attempt = 0; attempt < 10 && !session.canceled && !session.finishing; attempt++) {
        try {
          const replacement = await navigator.mediaDevices.getUserMedia({ audio: {
            echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          }, video: false });
          if (session.canceled || session.finishing) {
            replacement.getTracks().forEach(track => track.stop());
            break;
          }
          if (!replacement.getAudioTracks().some(track => track.readyState === 'live')) {
            replacement.getTracks().forEach(track => track.stop());
            throw new Error('Micro chưa sẵn sàng.');
          }
          session.mic = replacement;
          replacement.getAudioTracks().forEach(track => { track.enabled = !session.microphoneMuted; });
          connectMicrophone(session);
          watchTracks(session, replacement, true);
          session.recovering = false;
          publish({ status: 'recording', id: session.id, startedAt: session.startedAt });
          return;
        } catch {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      session.recovering = false;
      if (!session.canceled && !session.finishing) {
        session.failure = 'Micro đã ngắt kết nối và chưa tìm thấy thiết bị thay thế.';
        await stop();
      }
    }
    function watchTracks(session, stream, microphone = false) {
      for (const track of stream.getTracks()) {
        const listener = () => {
          if (microphone && session.microphoneOnly && session.started) {
            void recoverMicrophone(session);
            return;
          }
          if (microphone || !session.started) {
            session.failure ||= microphone
              ? 'Micro đã ngắt kết nối. Bản ghi đã dừng.'
              : 'Âm thanh tab đã kết thúc trước khi ghi âm bắt đầu. Hãy thử lại.';
          }
          void stop();
        };
        track.addEventListener('ended', listener);
        session.listeners.push([track, listener]);
      }
    }
    function ensureLiveInputs(session) {
      if (session.microphoneOnly) {
        if (session.mic && (!session.mic.getAudioTracks().some(track => track.readyState === 'live')
          || session.mic.getAudioTracks().some(track => track.readyState !== 'live'))) {
          throw new Error('Micro đã ngắt kết nối trước khi ghi âm bắt đầu. Hãy kiểm tra thiết bị và thử lại.');
        }
        return;
      }
      if (!session.display.getAudioTracks().some(track => track.readyState === 'live')
        || session.display.getTracks().some(track => track.readyState !== 'live')) {
        throw new Error('Âm thanh tab đã kết thúc trước khi ghi âm bắt đầu. Hãy thử lại.');
      }
      if (session.mic && (!session.mic.getAudioTracks().some(track => track.readyState === 'live')
        || session.mic.getAudioTracks().some(track => track.readyState !== 'live'))) {
        throw new Error('Micro đã ngắt kết nối trước khi ghi âm bắt đầu. Hãy thử lại.');
      }
    }
    async function encode(blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    }
    function enqueueChunk(session, blob) {
      if (!blob.size || session.failure) return;
      if (session.pending >= MAX_PENDING_CHUNKS) {
        fail(session, new Error('Lưu bản ghi quá chậm. Đã dừng để giữ an toàn phần âm thanh đã lưu.'));
        return;
      }
      const sequence = session.sequence++;
      session.pending++;
      session.queue = session.queue.then(async () => {
        if (session.failure) return;
        const data = await encode(blob);
        if (!session.failure) await request({ type: 'recording.chunk', id: session.id, sequence, data });
      }).catch(error => fail(session, error)).finally(() => { session.pending--; });
    }
    async function startSession(session, displayPromise, metadata) {
      try {
        if (!session.microphoneOnly) {
          session.display = await displayPromise;
          if (session.canceled) { await finish(session); return; }
          if (!session.display.getAudioTracks().some(track => track.readyState === 'live')) {
            throw new Error('Không thu được âm thanh tab Meet. Hãy bấm icon July để thử lại.');
          }
          ensureLiveInputs(session);
          watchTracks(session, session.display);
        }
        try {
          session.mic = await navigator.mediaDevices.getUserMedia({ audio: {
            echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          }, video: false });
        } catch {
          session.needsMicrophone = true;
          throw new Error('Chưa được cấp quyền micro. Hãy cho phép micro để ghi cả giọng của bạn.');
        }
        if (session.canceled) { await finish(session); return; }
        if (!session.mic.getAudioTracks().some(track => track.readyState === 'live')) {
          throw new Error('Không tìm thấy âm thanh micro. Hãy kiểm tra thiết bị và thử lại.');
        }
        ensureLiveInputs(session);
        watchTracks(session, session.mic, true);
        if (metadata.microphoneMuted === true) {
          session.mic.getAudioTracks().forEach(track => { track.enabled = false; });
        }
        session.context = new AudioContext();
        // Route only microphone audio into the recording output. For tab capture
        // compatibility, the legacy mixed branch still restores tab playback.
        session.destination = session.context.createMediaStreamDestination();
        session.output = session.destination.stream;
        connectMicrophone(session);
        if (!session.microphoneOnly) {
          const source = session.context.createMediaStreamSource(new MediaStream(session.display.getAudioTracks()));
          source.connect(session.destination);
          source.connect(session.context.destination);
          session.sources.push(source);
        }
        if (session.context.state === 'suspended') await session.context.resume();
        if (session.canceled) { await finish(session); return; }
        ensureLiveInputs(session);
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
        if (!mimeType) throw new Error('Trình duyệt không hỗ trợ ghi âm WebM. Hãy cập nhật Chrome.');
        session.recorder = new MediaRecorder(session.output, { mimeType, audioBitsPerSecond: 128000 });
        session.recorder.ondataavailable = event => enqueueChunk(session, event.data);
        session.recorder.onstop = () => { void finish(session); };
        session.recorder.onerror = event => fail(session, event.error || new Error('Ghi âm gặp lỗi.'));
        session.startedAt = new Date().toISOString();
        await request({ type: 'recording.begin', id: session.id, meetingUrl: metadata.meetingUrl,
          title: metadata.title, startedAt: session.startedAt, mimeType });
        session.persisted = true;
        if (session.canceled) {
          session.failure ||= 'Đã hủy trước khi ghi âm bắt đầu.';
          await finish(session); return;
        }
        ensureLiveInputs(session);
        session.recorder.start(1000);
        session.started = true;
        publish({ status: 'recording', id: session.id, startedAt: session.startedAt });
      } catch (error) {
        if (!session.canceled) {
          session.failure = error?.message || 'Không thể bắt đầu ghi âm.';
        }
        await finish(session);
      }
    }
    function start(metadata) {
      if (current) return current.starting;
      const session = { id: crypto.randomUUID(), queue: Promise.resolve(), pending: 0, sequence: 0,
        listeners: [], sources: [], canceled: false, persisted: false,
        microphoneOnly: Boolean(metadata?.microphoneOnly) };
      current = session;
      publish({ status: 'starting' });
      let displayPromise;
      if (metadata?.microphoneOnly) displayPromise = Promise.resolve(null);
      else try {
        if (typeof metadata?.streamId !== 'string' || !metadata.streamId) throw Error('Thiếu quyền thu âm tab. Hãy bấm icon July để bắt đầu.');
        displayPromise = navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: metadata.streamId } },
          video: false,
        });
      } catch (error) { displayPromise = Promise.reject(error); }
      session.starting = startSession(session, displayPromise, metadata);
      return session.starting;
    }
    function stop() {
      const session = current;
      if (!session) return Promise.resolve();
      if (session.stopping) return session.stopping;
      if (!session.recorder || !session.persisted || session.recorder.state === 'inactive') {
        session.canceled = true;
        void cleanup(session);
        // A pending media acquisition cannot be aborted; release any stream as
        // soon as it arrives and do not persist it.
        publish(session.failure ? { status: 'error', id: session.id, error: session.failure } : { status: 'idle' });
        return Promise.resolve();
      }
      session.stopping = new Promise(resolve => { session.resolveStopped = resolve; });
      publish({ status: 'saving', id: session.id, startedAt: session.startedAt });
      try { session.recorder.stop(); }
      catch (error) { session.failure ||= error.message; void finish(session); }
      return session.stopping;
    }
    function setMicrophoneMuted(muted) {
      if (!current?.mic) return false;
      current.microphoneMuted = Boolean(muted);
      current.mic.getAudioTracks().forEach(track => { track.enabled = !current.microphoneMuted; });
      return true;
    }
    return { start, stop, setMicrophoneMuted, getState: () => ({ ...state }) };
  }
  globalThis.MeetingRecorder = { create };
})();
