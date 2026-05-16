export const API_PREFIX = '/api';

export const HEALTH_PATH = `${API_PREFIX}/health`;

export const SESSIONS_PATH = `${API_PREFIX}/sessions`;
export const SESSION_STOP_PATH = `${SESSIONS_PATH}/:id/stop`;
export const SESSIONS_STOP_ALL_PATH = `${SESSIONS_PATH}/stop-all`;

export const DEVICES_PATH = `${API_PREFIX}/devices`;

export const SCRCPY_PATH = `${API_PREFIX}/scrcpy`;
export const SCRCPY_STOP_PATH = `${SCRCPY_PATH}/:id/stop`;
export const SCRCPY_STREAM_PATH = `${SCRCPY_PATH}/stream/:id`;
export const SCRCPY_DEVICE_STREAM_PATH = `${SCRCPY_PATH}/stream/device/:deviceSerial`;
