// Isolated content-script UI. No page-world code or credentials cross this boundary.
(() => {
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
        <header><span>July · Ghi âm</span><button class="quiet collapse" type="button" aria-label="Thu gọn">−</button></header>
        <button class="primary" type="button" hidden><span class="dot" aria-hidden="true"></span><span class="label">Dừng ghi âm</span></button>
        <p class="help"><span class="shortcut"></span> Micro được thu riêng, kể cả khi tắt mic trên Meet.</p>
        <p class="status" role="status">Vào cuộc họp để bắt đầu ghi âm</p>
        <p class="error" role="alert"></p>
        <footer><span class="timer">00:00</span><button class="quiet files" type="button">Bản ghi trên máy</button><button class="quiet settings" type="button" aria-label="Cài đặt July">Cài đặt</button></footer>
        <button class="quiet expand" type="button">Mở rộng</button>
      </section>`;
    const $ = selector => shadow.querySelector(selector);
    let meeting = { inCall: false, meetingUrl: null }, state = { status: 'idle' }, captureActive = false, receivedState = false, recordingRoom = null, absentSince = null, disposed = false;
    const active = () => captureActive || ['starting', 'recording', 'saving'].includes(state.status);
    function render() {
      const busy = state.status === 'saving';
      $('.primary').hidden = !active();
      $('.primary').disabled = busy || (!active() && !meeting.inCall);
      const label = busy ? 'Đang lưu…' : state.status === 'starting' ? 'Hủy ghi âm' : 'Dừng ghi âm';
      $('.label').textContent = label;
      $('.primary').setAttribute('aria-label', label);
      $('.error').textContent = state.error || '';
      $('.status').textContent = ({
        starting: 'Đang bắt đầu ghi âm…', recording: 'Đang ghi âm · Tiếng tab + micro',
        saving: 'Đang lưu bản ghi trên máy…', saved: 'Đã lưu trên máy · Chờ kết nối upload',
        'waiting-microphone': 'Đang chờ quyền micro · Sẽ tự bắt đầu ghi âm sau khi cho phép',
        error: captureActive ? 'Nguồn thu có thể còn hoạt động · Bấm Dừng để thử lại' : 'Ghi âm chưa hoàn tất · Kiểm tra bản ghi trên máy',
      })[state.status] || (meeting.inCall ? 'Bấm icon July để bắt đầu ghi âm' : 'Vào cuộc họp để bắt đầu ghi âm');
      $('.primary').title = state.status === 'recording' ? 'Dừng và lưu bản ghi' : label;
    }
    function apply(result) {
      if (disposed) return;
      if (!result?.ok) throw Error(result?.error || 'Không đọc được trạng thái ghi âm');
      state = result.state || { status: 'idle' };
      captureActive = Boolean(result.active);
      recordingRoom = result.meetingUrl || recordingRoom;
      if (result.shortcut !== undefined) $('.shortcut').textContent = result.shortcut ? `Phím tắt: ${result.shortcut}.` : '';
      if (state.status !== 'recording') absentSince = null;
      render();
    }
    function showError(error) { if (!disposed) { state = { status: 'error', error: error.message }; render(); } }
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
    $('.primary').addEventListener('click', () => {
      if (active()) { stop(); return; }
    });
    $('.collapse').addEventListener('click', () => $('.panel').classList.add('compact'));
    $('.expand').addEventListener('click', () => $('.panel').classList.remove('compact'));
    $('.files').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'recordings.open' }).then(result => {
        if (!result?.ok) throw Error(result?.error || 'Không mở được bản ghi');
      }).catch(error => { $('.error').textContent = error.message; });
    });
    $('.settings').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'settings.open' }).then(result => {
        if (!result?.ok) throw Error(result?.error || 'Không mở được cài đặt July');
      }).catch(error => { $('.error').textContent = error.message; });
    });
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
      updateMeeting(next) { meeting = next; render(); },
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
