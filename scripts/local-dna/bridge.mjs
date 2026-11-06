import { constants, openSync, closeSync, fstatSync, readFileSync, realpathSync, createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, extname } from 'node:path';

const SAMPLE_MIME = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
};

function samplePlayback(req, res, url) {
  let descriptor;
  try {
    const name = url.searchParams.get('filename');
    const mime = name && SAMPLE_MIME[extname(name).toLowerCase()];
    if (!['GET', 'HEAD'].includes(req.method) || !mime || basename(name) !== name || name.includes('\\')) {
      throw new Error('Invalid sample request');
    }
    const base = realpathSync('/home/rohan/lolixco-owner-media/inbox');
    descriptor = openSync(join(base, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size < 1 || info.size > 100 * 1024 * 1024) throw new Error('Unavailable sample');
    const size = info.size;
    let start = 0;
    let end = size - 1;
    if (req.headers.range) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (range) {
        start = Number(range[1]);
        end = range[2] ? Math.min(Number(range[2]), end) : end;
      }
      if (!range || !Number.isSafeInteger(start) || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
        return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Length', end - start + 1);
    if (req.method === 'HEAD') {
      res.end();
    } else {
      const stream = createReadStream(null, { fd: descriptor, start, end });
      descriptor = undefined;
      res.once('close', () => stream.destroy());
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    }
  } catch {
    res.writeHead(404).end('Previous local file unavailable');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function localDnaBridge() {
  return {
    name: 'local-dna-loopback-guard',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/v8') && !req.url?.startsWith('/__dna/')) return next();
        const { host, origin, 'sec-fetch-site': site } = req.headers;
        if (!host || host !== '127.0.0.1:5173' ||
            (origin && origin !== `http://${host}`) || (site && site !== 'same-origin' && site !== 'none')) {
          res.writeHead(403).end('Same-origin local workspace required');
          return;
        }
        if (req.url.startsWith('/__dna/')) {
          const url = new URL(req.url, `http://${host}`);
          if (url.pathname === '/__dna/media') samplePlayback(req, res, url);
          else res.writeHead(404).end();
          return;
        }
        next();
      });
    },
  };
}

export function dnaProxy() {
  return {
    target: 'http://127.0.0.1:5055',
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', proxyReq => {
        try {
          const capabilityPath = join(process.env.LOLIXCO_DNA_STATE_PARENT || homedir(), '.lolixco-edit-dna/codex-local-bridge.token');
          proxyReq.setHeader('x-lolixco-local-capability', readFileSync(capabilityPath, 'utf8').trim());
        } catch {
          proxyReq.destroy(new Error('Start npm run dna:serve first'));
        }
      });
    },
  };
}
