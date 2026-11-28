import { DEFAULT_LANGUAGE, LANGUAGE_KEY, getMessages, loadLanguage, normalizeLanguage } from './i18n.js';

const button = document.querySelector('#allow-microphone');
const syncStorage = globalThis.chrome?.storage?.sync;
let msg = getMessages(DEFAULT_LANGUAGE);
let running = false;

function applyTranslations(lang) {
  msg = getMessages(lang);
  document.documentElement.lang = normalizeLanguage(lang);
  document.title = msg.micDocTitle;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (typeof msg[key] === 'string') el.textContent = msg[key];
  }
}

globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes[LANGUAGE_KEY]) return;
  applyTranslations(changes[LANGUAGE_KEY].newValue);
});

async function authorizeMicrophone() {
  if (running) return;
  running = true;
  button.disabled = true;
  button.hidden = true;
  document.querySelector('#error').textContent = '';
  let stream, complete = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    document.querySelector('#microphone-status').textContent = msg.micGrantedResuming;
    // Keep this temporary stream alive until offscreen owns the microphone.
    // Closing this page earlier can release a one-time Chrome permission grant.
    const result = await chrome.runtime.sendMessage({ type: 'recording.microphone-ready' });
    if (!result?.ok) throw Error(result?.error || msg.micCannotResume);
    document.querySelector('#microphone-status').textContent = result.resumed ? msg.micRecordingClosing : msg.micGrantedClosing;
    complete = true;
  } catch (error) {
    document.querySelector('#error').textContent = error.name === 'NotAllowedError' || error.name === 'NotFoundError'
      ? msg.micDeniedError
      : error.message;
    button.textContent = msg.micRetry;
    button.disabled = false;
    button.hidden = false;
  } finally {
    stream?.getTracks().forEach(track => track.stop());
    running = false;
  }
  if (complete) window.close();
}
button.addEventListener('click', authorizeMicrophone);
(async () => {
  applyTranslations(await loadLanguage(syncStorage));
  await authorizeMicrophone();
})();
