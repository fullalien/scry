import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../../package.json');

export const APP_NAME = 'scry';
export const APP_VERSION = pkg.version as string;
