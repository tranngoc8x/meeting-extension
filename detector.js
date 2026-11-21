// Classic script: MV3 declarative content scripts do not support static imports.
// This namespace lives in the extension's isolated world, never the Meet page world.
(() => {
  // Meet renders the control bar (with Leave call) as a sibling of [role=main], not inside it,
  // so watch the whole body. ponytail: body-wide subtree observer; the record filter below
  // keeps it to control changes. Narrow to the call container if it ever shows up in profiles.
  const ROOT = 'body';
  const BUTTON = 'button,[role="button"]';
  const RELEVANT = `${ROOT},${BUTTON},[role="toolbar"]`;
  function normalizeUrl(value) {
    try {
      const url = new URL(value);
      return url.origin === 'https://meet.google.com' && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname)
        ? `${url.origin}${url.pathname.replace(/\/$/, '')}` : null;
    } catch { return null; }
  }
  function create({ document, getUrl = () => document.location.href, onTransition }) {
    const win = document.defaultView;
    const stats = { checks: 0 };
    let root, timer, stopped = false;
    let state = { inCall: false, meetingUrl: normalizeUrl(getUrl()), detectedAt: null };
    let observers = [];
    function visible(button) {
      if (button.disabled || button.getAttribute('aria-disabled') === 'true' || !button.getClientRects().length) return false;
      for (let node = button; node; node = node.parentElement) {
        if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
        const style = win.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      }
      return true;
    }
    function isLeave(button) {
      const label = button.getAttribute('aria-label')?.trim().toLowerCase();
      if (['leave call', 'leave meeting', 'rời cuộc gọi', 'rời khỏi cuộc gọi', 'rời cuộc họp'].includes(label)) return true;
      return [...button.querySelectorAll('.google-symbols,.material-icons,[data-google-symbol]')]
        .some(icon => (icon.getAttribute('data-google-symbol') || icon.textContent.trim()) === 'call_end');
    }
    function check() {
      stats.checks++;
      const meetingUrl = normalizeUrl(getUrl());
      const inCall = Boolean(meetingUrl && root && [...root.querySelectorAll(BUTTON)].some(b => isLeave(b) && visible(b)));
      const changed = inCall !== state.inCall || (inCall && meetingUrl !== state.meetingUrl);
      state = { inCall, meetingUrl, detectedAt: changed ? new Date().toISOString() : state.detectedAt };
      if (changed) onTransition({ ...state });
    }
    function schedule() {
      if (stopped || timer !== undefined) return;
      // One trailing batch, bounded even under sustained mutation traffic; no polling.
      timer = win.setTimeout(() => {
        timer = undefined;
        const next = document.querySelector(ROOT);
        if (next !== root || !root?.isConnected) bind(next);
        check();
      }, 50);
    }
    function touchesControls(records) {
      return records.some(r => r.type === 'attributes' || r.type === 'characterData' && r.target.parentElement?.closest(BUTTON)
        || r.type === 'childList' && (r.target.closest?.(BUTTON) || [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && (n.matches(RELEVANT) || n.querySelector(RELEVANT)))));
    }
    function observe(node, options, callback) {
      const observer = new win.MutationObserver(callback);
      observer.observe(node, options);
      observers.push(observer);
    }
    function bind(next) {
      observers.forEach(o => o.disconnect());
      observers = [];
      root = next;
      if (root) {
        observe(root, {subtree:true, childList:true, characterData:true, attributes:true,
          attributeFilter:['aria-label','aria-disabled','aria-hidden','disabled','hidden','style','class','data-google-symbol']}, records => {
          // Ignore participant/chat attribute churn outside controls and their ancestors.
          if (touchesControls(records.filter(r => r.type !== 'attributes' || r.target.matches(`${BUTTON},[role="toolbar"],${ROOT}`) || r.target.querySelector(BUTTON)))) schedule();
        });
        // Only direct children of the ancestor chain: detect replacement without a
        // second whole-document subtree observer while a call root is available.
        for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
          observe(ancestor, {childList:true, attributes:true, attributeFilter:['hidden','aria-hidden','style','class']}, schedule);
        }
      } else {
        // Temporary discovery mode, child-list only. Search changed subtrees, never
        // rescan the document per mutation. Removed roots are handled by ancestors.
        observe(document.documentElement, {childList:true, subtree:true}, records => {
          if (records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && (n.matches(ROOT) || n.querySelector(ROOT))))) schedule();
        });
      }
    }
    function stop() {
      if (stopped) return;
      stopped = true;
      observers.forEach(o => o.disconnect());
      observers = [];
      win.clearTimeout(timer);
      win.removeEventListener('popstate', schedule);
      win.removeEventListener('hashchange', schedule);
    }
    bind(document.querySelector(ROOT));
    win.addEventListener('popstate', schedule);
    win.addEventListener('hashchange', schedule);
    check();
    return { stop, stats, getState: () => ({...state}) };
  }
  globalThis.MeetDetector = { create, normalizeUrl };
})();
