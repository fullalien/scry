export const API_PREFIX = '/api';

export const DEVICES_PATH = `${API_PREFIX}/devices`;

export const SCRCPY_PATH = `${API_PREFIX}/scrcpy`;
export const SCRCPY_STOP_PATH = `${SCRCPY_PATH}/:id/stop`;
export const SCRCPY_STREAM_PATH = `${SCRCPY_PATH}/stream/:id`;
export const SCRCPY_DEVICE_STREAM_PATH = `${SCRCPY_PATH}/stream/device/:deviceSerial`;
export const SCRCPY_DEVICE_CONTROL_PATH = `${SCRCPY_PATH}/control/device/:deviceSerial`;
