import { homedir } from 'node:os';
import path from 'node:path';
import { APP_NAME } from '../constants.js';

export const CONFIG_PATH = path.join(
  homedir(),
  APP_NAME,
  'config.json'
);
