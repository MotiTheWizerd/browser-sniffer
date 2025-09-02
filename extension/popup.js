document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('start').addEventListener('click', () => {
    chrome.runtime.sendMessage({ command: 'start' });
  });
  document.getElementById('stop').addEventListener('click', () => {
    chrome.runtime.sendMessage({ command: 'stop' });
  });
  document.getElementById('export').addEventListener('click', () => {
    chrome.runtime.sendMessage({ command: 'export' });
  });
  document.getElementById('purge').addEventListener('click', () => {
    chrome.runtime.sendMessage({ command: 'purge' });
  });
});
