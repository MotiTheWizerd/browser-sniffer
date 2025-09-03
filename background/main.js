import { loadSettings } from './settings.js';

(async () => {
  try {
    await loadSettings();
  } catch (err) {
    console.warn('Failed to load settings', err);
  }
  await import('./runtime.js');
})();
