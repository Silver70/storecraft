import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { createRequire } from 'module';

/**
 * Serves the drop-in storefront editing bridge (`ie.js`) at the root path `/ie.js`
 * (excluded from the global `/api` prefix in main.ts). The built artifact comes
 * from the `@repo/inline-edit-js` workspace package; it's read once and cached in
 * memory with a content-hash ETag and a modest browser cache. Public + no auth —
 * it's a static asset embedded via a `<script>` tag on third-party storefronts.
 */
@Controller()
export class InlineEditScriptController {
  private script: Buffer | null = null;
  private etag = '';

  constructor() {
    this.load();
  }

  private load(): void {
    const candidates: string[] = [];
    try {
      candidates.push(
        createRequire(__filename).resolve('@repo/inline-edit-js/ie.js'),
      );
    } catch {
      // package not linked yet — fall through to path candidates
    }
    candidates.push(
      join(process.cwd(), 'node_modules/@repo/inline-edit-js/dist/ie.js'),
      join(process.cwd(), '../../packages/inline-edit-js/dist/ie.js'),
    );
    for (const path of candidates) {
      try {
        const buf = readFileSync(path);
        this.script = buf;
        this.etag = `"${createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;
        return;
      } catch {
        // try next candidate
      }
    }
  }

  @Get('ie.js')
  @ApiExcludeEndpoint()
  serve(@Req() req: Request, @Res() res: Response): void {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!this.script) this.load(); // lazily retry (e.g. built after boot)
    if (!this.script) {
      res
        .status(503)
        .type('application/javascript')
        .send('/* ie.js unavailable */');
      return;
    }
    if (req.headers['if-none-match'] === this.etag) {
      res.status(304).end();
      return;
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('ETag', this.etag);
    res.send(this.script);
  }
}
