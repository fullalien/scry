import path from 'path';
import { homedir } from 'os';

export const APP_NAME = 'scry';

export const CONFIG_DIR = path.join(homedir(), `.${APP_NAME}`);
