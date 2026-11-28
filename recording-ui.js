// Isolated content-script UI. No page-world code or credentials cross this boundary.
(() => {
  const UI_MESSAGES = {
    vi: {
      panelAria: 'July ghi âm cuộc họp',
      headerTitle: 'July · Ghi âm',
      collapseAria: 'Thu gọn',
      help: 'Âm thanh chỉ lấy từ micro. Khi tắt mic trên Meet, đoạn đó sẽ im lặng.',
      shortcutPrefix: 'Phím tắt:',
      filesBtn: 'Bản ghi trên máy',
      settingsBtn: 'Cài đặt',
      settingsAria: 'Cài đặt July',
      expandBtn: 'Mở rộng',
      savingBtn: 'Đang lưu…',
      cancelBtn: 'Hủy ghi âm',
      stopBtn: 'Dừng ghi âm',
      recordBtn: 'Ghi âm',
      stopTitle: 'Dừng và lưu bản ghi',
      statusStarting: 'Đang bắt đầu ghi âm…',
      statusRecording: 'Đang ghi âm · Chỉ micro',
      statusSaving: 'Đang lưu bản ghi trên máy…',
      statusSaved: 'Đã lưu trên máy',
      statusWaitingMic: 'Đang chờ quyền micro · Sẽ tự bắt đầu ghi âm sau khi cho phép',
      statusErrorActive: 'Nguồn thu có thể còn hoạt động · Bấm Dừng để thử lại',
      statusErrorInvoke: 'Bấm icon July để ghi lần đầu trên tab này',
      statusErrorIncomplete: 'Ghi âm chưa hoàn tất · Kiểm tra bản ghi trên máy',
      statusReady: 'Sẵn sàng ghi âm',
      statusIdle: 'Vào cuộc họp để bắt đầu ghi âm',
      readStateError: 'Không đọc được trạng thái ghi âm',
      openRecordingsError: 'Không mở được bản ghi',
      openSettingsError: 'Không mở được cài đặt July',
    },
    en: {
      panelAria: 'July meeting recorder',
      headerTitle: 'July · Record',
      collapseAria: 'Collapse',
      help: 'Only microphone audio is recorded. Muting in Meet records silence.',
      shortcutPrefix: 'Shortcut:',
      filesBtn: 'Local recordings',
      settingsBtn: 'Settings',
      settingsAria: 'July settings',
      expandBtn: 'Expand',
      savingBtn: 'Saving…',
      cancelBtn: 'Cancel',
      stopBtn: 'Stop recording',
      recordBtn: 'Record',
      stopTitle: 'Stop and save recording',
      statusStarting: 'Starting recording…',
      statusRecording: 'Recording · Mic only',
      statusSaving: 'Saving recording locally…',
      statusSaved: 'Saved locally',
      statusWaitingMic: 'Waiting for mic permission · Recording starts once allowed',
      statusErrorActive: 'Capture may still be active · Click Stop to retry',
      statusErrorInvoke: 'Click the July icon to record on this tab first',
      statusErrorIncomplete: 'Recording incomplete · Check local recordings',
      statusReady: 'Ready to record',
      statusIdle: 'Join a meeting to start recording',
      readStateError: 'Could not read recording status',
      openRecordingsError: 'Could not open recordings',
      openSettingsError: 'Could not open July settings',
    },
  };
  function hasCallControl() {
    return [...document.querySelectorAll('button,[role="button"]')].some(button => {
      const label = button.getAttribute('aria-label')?.trim().toLowerCase();
      return ['leave call', 'leave meeting', 'rời cuộc gọi', 'rời khỏi cuộc gọi', 'rời cuộc họp'].includes(label)
        || [...button.querySelectorAll('.google-symbols,.material-icons,[data-google-symbol]')]
          .some(icon => (icon.getAttribute('data-google-symbol') || icon.textContent.trim()) === 'call_end');
    });
  }
  function create() {
    const host = document.createElement('div');
    host.id = 'july-recording-panel';
    // Keep positioning outside Meet's layout and its body rerenders.
    host.style.cssText = 'all:initial;position:fixed;right:20px;bottom:100px;z-index:2147483647;max-width:calc(100vw - 24px)';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host{color-scheme:light dark}
        *{box-sizing:border-box}button{font:inherit;cursor:pointer}button:disabled{cursor:default;opacity:.6}
        button:focus-visible{outline:3px solid #718cff;outline-offset:3px}
        .panel{font:14px/1.45 system-ui,-apple-system,sans-serif;color:#172033;width:290px;max-width:calc(100vw - 24px);background:#fff;border:1px solid #e3e6ec;border-radius:16px;box-shadow:0 8px 32px #0003;padding:16px}
        header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;font-weight:700}
        .quiet{border:0;background:transparent;color:inherit;border-radius:6px;padding:4px 6px}
        .primary{display:flex;gap:8px;align-items:center;justify-content:center;width:100%;border:0;border-radius:10px;background:#bb293e;color:white;padding:11px 14px;font-weight:650}.primary[hidden]{display:none}
        .dot{height:9px;width:9px;border-radius:50%;background:currentColor;flex:none}
        .help{color:#596477;font-size:12px;margin:10px 0 0}.status{font-size:12px;margin:10px 0 0}
        .error{color:#b11c35;font-size:12px;margin:8px 0 0;overflow-wrap:anywhere}.error:empty{display:none}
        footer{display:flex;align-items:center;justify-content:space-between;margin-top:8px}.timer{font-variant-numeric:tabular-nums;font-size:13px}
        .files{font-size:12px;color:#344a88;text-decoration:underline}
        .compact{width:auto;padding:10px}.compact header,.compact .help,.compact footer{display:none}.compact .status{max-width:230px}
        .compact .expand{display:block;margin:6px auto 0;font-size:11px}.expand{display:none}
        .compact .error{max-width:220px}
        @media(prefers-color-scheme:dark){.panel{color:#f1f3f8;background:#20242c;border-color:#3b404a}.help{color:#b4bdcd}.files{color:#b1c6ff}.error{color:#ff9bad}}
      </style>
      <section class="panel" aria-label="July ghi âm cuộc họp">
        <header><span class="header-title">July · Ghi âm</span><button class="quiet collapse" type="button" aria-label="Thu gọn">−</button></header>
        <button class="primary" type="button" disabled><span class="dot" aria-hidden="true"></span><span class="label">Ghi âm</span></button>
        <p class="help"><span class="help-text">Âm thanh chỉ lấy từ micro. Khi tắt mic trên Meet, đoạn đó sẽ im lặng.</span> <span class="shortcut"></span></p>
        <p class="status" role="status">Vào cuộc họp để bắt đầu ghi âm</p>
        <p class="error" role="alert"></p>
        <footer><span class="timer">00:00</span><button class="quiet files" type="button">Bản ghi trên máy</button><button class="quiet settings" type="button" aria-label="Cài đặt July">Cài đặt</button></footer>
        <button class="quiet expand" type="button">Mở rộng</button>
      </section>`;
    const $ = selector => shadow.querySelector(selector);
    let msg = UI_MESSAGES.vi, currentShortcut = '';
    let meeting = { inCall: false, meetingUrl: null }, state = { status: 'idle' }, captureActive = false, receivedState = false, recordingRoom = null, absentSince = null, disposed = false;
    const active = () => captureActive || ['starting', 'recording', 'saving'].includes(state.status);
    function applyLanguage(lang) {
      msg = UI_MESSAGES[lang === 'en' ? 'en' : 'vi'];
      $('.panel').setAttribute('aria-label', msg.panelAria);
      $('.header-title').textContent = msg.headerTitle;
      $('.collapse').setAttribute('aria-label', msg.collapseAria);
      $('.help-text').textContent = msg.help;
      $('.files').textContent = msg.filesBtn;
      $('.settings').textContent = msg.settingsBtn;
      $('.settings').setAttribute('aria-label', msg.settingsAria);
      $('.expand').textContent = msg.expandBtn;
      if (currentShortcut) $('.shortcut').textContent = `${msg.shortcutPrefix} ${currentShortcut}.`;
      render();
    }
    function render() {
      const busy = state.status === 'saving';
      const waiting = state.status === 'waiting-microphone';
      $('.primary').disabled = busy || (!active() && !waiting && !meeting.inCall);
      const label = busy ? msg.savingBtn : state.status === 'starting' || waiting ? msg.cancelBtn : active() ? msg.stopBtn : msg.recordBtn;
      $('.label').textContent = label;
      $('.primary').setAttribute('aria-label', label);
      $('.error').textContent = state.error || '';
      $('.status').textContent = ({
        starting: msg.statusStarting, recording: msg.statusRecording,
        saving: msg.statusSaving, saved: msg.statusSaved,
        'waiting-microphone': msg.statusWaitingMic,
        error: captureActive ? msg.statusErrorActive : state.needsInvocation ? msg.statusErrorInvoke : msg.statusErrorIncomplete,
      })[state.status] || (meeting.inCall ? msg.statusReady : msg.statusIdle);
      $('.primary').title = state.status === 'recording' ? msg.stopTitle : label;
    }
    function apply(result) {
      if (disposed) return;
      if (!result?.ok) throw Object.assign(Error(result?.error || msg.readStateError), { needsInvocation: Boolean(result?.needsInvocation) });
      state = result.state || { status: 'idle' };
      captureActive = Boolean(result.active);
      recordingRoom = result.meetingUrl || recordingRoom;
      if (result.shortcut !== undefined) {
        currentShortcut = result.shortcut || '';
        $('.shortcut').textContent = currentShortcut ? `${msg.shortcutPrefix} ${currentShortcut}.` : '';
      }
      if (state.status !== 'recording') absentSince = null;
      render();
    }
    function showError(error) { if (!disposed) { state = { status: 'error', error: error.message, ...(error.needsInvocation ? { needsInvocation: true } : {}) }; render(); } }
    function onMessage(message, sender) {
      if (message?.type !== 'recording.state' || sender.id !== chrome.runtime.id) return;
      receivedState = true;
      apply({ ...message, ok: true });
    }
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.runtime.sendMessage({ type: 'recording.status' }).then(result => { if (!receivedState) apply(result); }).catch(showError);
    function stop() {
      state = { ...state, status: 'saving' }; render();
      chrome.runtime.sendMessage({ type: 'recording.stop' }).then(apply).catch(showError);
    }
    $('.primary').addEventListener('click', event => {
      // Page scripts can reach the shared DOM, but cannot manufacture a trusted
      // user click to activate the microphone after tab permission was granted.
      if (!event.isTrusted) return;
      if (active() || state.status === 'waiting-microphone') { stop(); return; }
      if (!meeting.inCall) return;
      state = { status: 'starting' }; render();
      chrome.runtime.sendMessage({ type: 'recording.start' }).then(apply).catch(showError);
    });
    $('.collapse').addEventListener('click', () => $('.panel').classList.add('compact'));
    $('.expand').addEventListener('click', () => $('.panel').classList.remove('compact'));
    $('.files').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'recordings.open' }).then(result => {
        if (!result?.ok) throw Error(result?.error || msg.openRecordingsError);
      }).catch(error => { $('.error').textContent = error.message; });
    });
    $('.settings').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'settings.open' }).then(result => {
        if (!result?.ok) throw Error(result?.error || msg.openSettingsError);
      }).catch(error => { $('.error').textContent = error.message; });
    });
    const onStorageChanged = (changes, areaName) => {
      if (areaName === 'sync' && changes.uiLanguage) applyLanguage(changes.uiLanguage.newValue);
    };
    chrome.storage?.sync?.get('uiLanguage').then(saved => {
      if (!disposed && saved?.uiLanguage) applyLanguage(saved.uiLanguage);
    }).catch(() => {});
    chrome.storage?.onChanged?.addListener(onStorageChanged);
    const ticker = setInterval(() => {
      if (state.startedAt) {
        const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(state.startedAt)) / 1000));
        $('.timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      }
      if (state.status !== 'recording') return;
      const room = globalThis.MeetDetector?.normalizeUrl(document.location.href);
      if (globalThis.MeetDetector && room !== recordingRoom) { stop(); return; }
      // Meet can hide controls under a modal. Presence, not visibility, governs auto-stop.
      if (meeting.inCall || hasCallControl()) { absentSince = null; return; }
      absentSince ??= Date.now();
      if (Date.now() - absentSince >= 6000) { absentSince = null; stop(); }
    }, 1000);
    document.documentElement.append(host);
    render();
    return {
      updateMeeting(next) {
        const muteChanged = next?.micMuted !== undefined && next.micMuted !== meeting.micMuted;
        meeting = next;
        if (muteChanged && state.status === 'recording') {
          chrome.runtime.sendMessage({ type: 'recording.microphone-muted', muted: next.micMuted }).catch(() => {});
        }
        render();
      },
      dispose() {
        disposed = true;
        clearInterval(ticker);
        chrome.runtime.onMessage.removeListener(onMessage);
        if (active()) chrome.runtime.sendMessage({ type: 'recording.stop' }).catch(() => {});
        host.remove();
      },
    };
  }
  globalThis.MeetingRecordingUI = { create };
})();
