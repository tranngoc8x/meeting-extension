export const RECORDING_MESSAGES = new Set(['recording.start', 'recording.stop', 'recording.status', 'recording.state', 'recording.microphone-ready', 'recording.microphone-muted', 'recordings.open', 'microphone.open', 'settings.open']);

/** Meet controls are scoped to their sender tab/document; Chrome enforces capture invocation. */
export function createRecordingService({ controller, runtimeId, getURL, openLibrary, openSettings }) {
  return async function handle(message, sender) {
    if (!RECORDING_MESSAGES.has(message?.type)) return;
    if (message.type === 'recording.state') return controller.onState(message, sender);
    if (message.type === 'recording.microphone-ready') {
      if (sender.id !== runtimeId || sender.url !== getURL('microphone.html') || sender.frameId !== 0
          || !Number.isInteger(sender.tab?.id)) throw Error('Untrusted microphone permission sender');
      return controller.microphoneReady(sender.tab.id);
    }
    const popup = sender.id === runtimeId && sender.url === getURL('popup.html');
    let meet = false;
    try { meet = new URL(sender.url).origin === 'https://meet.google.com'; } catch { /* untrusted below */ }
    const content = sender.id === runtimeId && sender.frameId === 0 && typeof sender.documentId === 'string'
      && Boolean(sender.documentId) && Number.isInteger(sender.tab?.id) && sender.tab.id >= 0 && meet;
    if (!popup && !content) throw Error('Untrusted recording sender');
    if (message.type === 'recording.start') {
      return popup ? controller.start() : controller.startFromContent({ id: sender.tab.id }, sender.url, sender.documentId);
    }
    if (message.type === 'recording.status') return popup ? controller.status() : controller.status(sender.tab.id);
    if (message.type === 'recording.stop') return popup ? controller.stop() : controller.stop(sender.tab.id);
    if (message.type === 'recording.microphone-muted') {
      if (!content) throw Error('Untrusted microphone state sender');
      return controller.setMicrophoneMuted(sender.tab.id, Boolean(message.muted));
    }
    if (message.type === 'microphone.open') {
      if (!popup) throw Error('Untrusted microphone permission request');
      await controller.openMicrophone();
    } else if (message.type === 'settings.open') await openSettings();
    else await openLibrary();
    return { ok: true };
  };
}
