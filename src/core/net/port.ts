import net from 'node:net';
import getPort from 'get-port';

export async function isPortAvailable(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    // some platforms require host to be omitted for wildcard binds
    try {
      server.listen(port, host);
    } catch (e) {
      resolve(false);
    }
  });
}

/**
 * Return the preferred port if available, otherwise use `get-port` to find
 * and return an available port.
 */
export async function getAvailablePort(
  host: string,
  preferredPort: number
): Promise<number> {
  if (await isPortAvailable(host, preferredPort)) return preferredPort;
  // Ask get-port to try the preferred port first; it will return an available
  // port if the preferred one is occupied.
  return getPort({ port: preferredPort });
}

export default getAvailablePort;
