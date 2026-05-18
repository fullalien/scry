export function getDeviceSerialFromUrl(): string | null {
  const path = window.location.pathname;
  const match = path.match(/^\/device\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}
