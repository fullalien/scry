import path from 'path';
import { homedir } from 'os';

export const APP_NAME = 'scrcpy-web';

export const CONFIG_DIR = path.join(homedir(), `.${APP_NAME}`);
