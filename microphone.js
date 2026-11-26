const button = document.querySelector('#allow-microphone');
let running = false;
async function authorizeMicrophone() {
  if (running) return;
  running = true;
  button.disabled = true;
  button.hidden = true;
  document.querySelector('#error').textContent = '';
  let stream, complete = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    document.querySelector('#microphone-status').textContent = 'Đã cấp quyền micro. July đang tiếp tục bản ghi đang chờ…';
    // Keep this temporary stream alive until offscreen owns the microphone.
    // Closing this page earlier can release a one-time Chrome permission grant.
    const result = await chrome.runtime.sendMessage({ type: 'recording.microphone-ready' });
    if (!result?.ok) throw Error(result?.error || 'Không thể tiếp tục ghi âm cuộc họp.');
    document.querySelector('#microphone-status').textContent = result.resumed ? 'Đang ghi âm. Trang này sẽ tự đóng.' : 'Đã cấp quyền micro. Trang này sẽ tự đóng.';
    complete = true;
  } catch (error) {
    document.querySelector('#error').textContent = error.name === 'NotAllowedError' || error.name === 'NotFoundError'
      ? 'Chưa thể truy cập micro. Cho phép micro cho July trong Chrome và quyền Microphone của Chrome trong cài đặt hệ điều hành, rồi thử lại.'
      : error.message;
    button.textContent = 'Thử lại';
    button.disabled = false;
    button.hidden = false;
  } finally {
    stream?.getTracks().forEach(track => track.stop());
    running = false;
  }
  if (complete) window.close();
}
button.addEventListener('click', authorizeMicrophone);
void authorizeMicrophone();
