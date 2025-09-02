document.addEventListener('DOMContentLoaded', () => {
  const send = (command) => chrome.runtime.sendMessage({ command });
  const $ = (id) => document.getElementById(id);

  $('#start')?.addEventListener('click', () => send('start'));
  $('#stop')?.addEventListener('click', () => send('stop'));
  $('#export')?.addEventListener('click', () => send('export'));
  $('#purge')?.addEventListener('click', () => send('purge'));
});
