(() => {
  globalThis.__meetDetectionStop?.();
  let detector, recordingPanel, closed = false, pending = Promise.resolve(), status = 'No transition saved';
  let latestEvent = null;
  const retries = new Map();
  async function save(event) {
    for (let attempt = 0; attempt < 3 && !closed; attempt++) {
      try {
        const response = await chrome.runtime.sendMessage({type:'meet.transition',event});
        if (!response?.ok) throw Error('Save failed');
        latestEvent = response.event;
        status = 'Saved locally';
        return;
      } catch {
        status = 'Local save failed';
        if (attempt < 2 && !closed) await new Promise(resolve => {
          const timer = setTimeout(() => { retries.delete(timer); resolve(); }, 250 * (attempt + 1));
          retries.set(timer, resolve);
        });
      }
    }
  }
  function start() {
    if (detector) return;
    closed = false;
    if (MeetDetector.normalizeUrl(document.location.href)) recordingPanel = MeetingRecordingUI.create();
    detector = MeetDetector.create({document, onTransition: transition => {
      if (!recordingPanel && MeetDetector.normalizeUrl(document.location.href)) recordingPanel = MeetingRecordingUI.create();
      recordingPanel?.updateMeeting(transition);
      const event = {...transition,requestId:crypto.randomUUID()};
      status = 'Saving locally';
      pending = pending.then(() => save(event)).catch(() => { status='Local save failed'; });
    }});
    recordingPanel?.updateMeeting(detector.getState());
  }
  function suspend() {
    closed = true;
    detector?.stop();
    detector = null;
    recordingPanel?.dispose();
    recordingPanel = null;
    for (const [timer,resolve] of retries) { clearTimeout(timer); resolve(); }
    retries.clear();
  }
  function onMessage(message, _sender, respond) {
    if (message?.type === 'meet.status') respond({
      detected: Boolean(detector), ...detector?.getState(), localSave:status,
      requestId:latestEvent?.requestId ?? null, backendConnected:false
    });
  }
  function resume(event) { if(event.persisted) start(); }
  function stop() {
    suspend();
    chrome.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener('pagehide',suspend);
    window.removeEventListener('pageshow',resume);
  }
  chrome.runtime.onMessage.addListener(onMessage);
  window.addEventListener('pagehide',suspend);
  window.addEventListener('pageshow',resume);
  globalThis.__meetDetectionStop = stop;
  start();
})();
