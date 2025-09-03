document.addEventListener('DOMContentLoaded', () => {
  function sendCommand(command) {
    chrome.runtime.sendMessage({ command }, (resp) => {
      if (chrome.runtime.lastError) {
        console.error('Command failed', chrome.runtime.lastError);
      } else {
        console.log(resp);
      }
    });
  }

  document.getElementById('start').addEventListener('click', () => sendCommand('start'));
  document.getElementById('stop').addEventListener('click', () => sendCommand('stop'));
  document.getElementById('export').addEventListener('click', () => sendCommand('export'));
  document.getElementById('purge').addEventListener('click', () => sendCommand('purge'));
});

