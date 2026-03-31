/**
 * Minimal HTTP GET helper using Node's built-in https module.
 * Returns parsed JSON by default, or raw text when `raw` is true.
 */

import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';

export async function httpGet<T>(
  url: string,
  headers: Record<string, string> = {},
  raw = false
): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Kitsune-Migration-Agent/0.1.0',
        ...headers,
      },
    };

    const req = lib.request(options, res => {
      // Handle redirects (up to 5)
      if (
        res.statusCode &&
        [301, 302, 303, 307, 308].includes(res.statusCode) &&
        res.headers.location
      ) {
        res.resume();
        httpGet<T>(res.headers.location, headers, raw).then(resolve, reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(
          new Error(
            `HTTP ${res.statusCode} fetching ${url}. ` +
            `Check your token configuration and that the PR URL is correct.`
          )
        );
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (raw) {
          resolve(body as unknown as T);
          return;
        }
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          reject(new Error(`Failed to parse JSON from ${url}: ${body.slice(0, 200)}`));
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
    req.end();
  });
}
