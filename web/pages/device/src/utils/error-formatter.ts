export function formatStreamError(raw: string): {
  message: string;
  hint?: string;
} {
  if (raw.startsWith('No device serial')) {
    return { message: 'No device serial in URL' };
  }
  if (raw.startsWith('WebCodecs')) {
    return {
      message: "Browser doesn't support screen mirroring",
      hint: 'Use Chrome 94+, Firefox 130+, or Safari 16.4+',
    };
  }
  if (raw.startsWith('WebSocket')) {
    return {
      message: 'Cannot connect to device',
      hint: 'Server may be unreachable or device is offline',
    };
  }
  if (raw.startsWith('Stream closed')) {
    const detail = raw.replace('Stream closed: ', '');
    return { message: 'Stream disconnected', hint: detail };
  }
  if (raw.startsWith('Stream connection timed out')) {
    return {
      message: 'Stream connection timed out',
      hint: 'Server may be busy or device is offline. Try again.',
    };
  }
  return { message: 'Video decoding error', hint: raw };
}
