import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdPlatformConnectionService } from '../services/ad-platform-connection.service';

/**
 * Where an ad platform sends the merchant when they are finished.
 *
 * Deliberately outside `/admin`. This is a browser redirect arriving from a
 * third party, so it carries no admin token and no store header; what
 * authenticates it is the signed note we pinned to the merchant on the way out,
 * which names the Organization, the Store and the platform. Nothing here trusts
 * a query parameter to say whose connection this is — the same reason the
 * Stripe webhook resolves its tenant from a record rather than from the payload.
 *
 * It always ends in a redirect into the admin. A merchant who approved, denied,
 * or closed the tab and wandered back an hour later lands on the same page,
 * which tells them which of those happened. There is no path through here that
 * leaves them looking at an error body.
 */
@ApiTags('Ad platforms')
@Controller('ad-platforms')
export class AdPlatformCallbackController {
  constructor(private readonly connections: AdPlatformConnectionService) {}

  @Get('callback')
  @ApiExcludeEndpoint()
  async callback(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const { state, ...callbackParams } = query;
    const outcome = await this.connections.complete(state, callbackParams);
    res.redirect(this.connections.returnUrlFor(outcome));
  }
}
