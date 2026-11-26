const button = document.querySelector('#allow-microphone');
button.addEventListener('click', async () => {
  button.disabled = true;
  document.querySelector('#error').textContent = '';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    document.querySelector('#microphone-status').textContent = 'Đã cấp quyền micro. Quay lại tab Meet và bấm icon July → Ghi âm.';
    button.textContent = 'Đã cho phép micro';
  } catch {
    document.querySelector('#error').textContent = 'Chưa thể truy cập micro. Cho phép micro cho July trong Chrome và quyền Microphone của Chrome trong cài đặt hệ điều hành, rồi thử lại.';
    button.disabled = false;
  } finally {
    stream?.getTracks().forEach(track => track.stop());
  }
});
