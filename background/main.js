import { loadSettings } from './settings.js';
import './runtime.js';

loadSettings().catch(err => {
  console.warn('Failed to load settings', err);
});
