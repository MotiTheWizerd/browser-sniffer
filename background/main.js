import { loadSettings } from './settings.js';
import './runtime.js';

try {
  await loadSettings();
} catch (err) {
  console.warn('Failed to load settings', err);
}
