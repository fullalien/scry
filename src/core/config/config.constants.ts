import { homedir } from 'node:os';
import path from 'node:path';
import { APP_NAME } from '../constants.js';

export const CONFIG_PATH = path.join(homedir(), APP_NAME, 'config.json');

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8080;
