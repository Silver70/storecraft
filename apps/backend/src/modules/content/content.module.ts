import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminContentSlotController } from './controllers/admin-content-slot.controller';
import { ContentSlotResolver } from './resolvers/content-slot.resolver';
import { ContentSlotRepository } from './repositories/content-slot.repository';
import { ContentSlotService } from './services/content-slot.service';

/**
 * Content: the named regions a storefront renders at stable keys, and the
 * draft-and-publish cycle that fills them. A standalone feature module in the
 * same shape as marketing and analytics — it owns its table, its admin
 * endpoints, and its one public read, and nothing in commerce depends on it.
 *
 * It deliberately holds no editing surface of its own. Inline edits to product
 * and category copy go through the existing product endpoints, because a
 * second write path for the same field is a second place for validation and
 * permissions to drift.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminContentSlotController],
  providers: [ContentSlotRepository, ContentSlotService, ContentSlotResolver],
  exports: [ContentSlotService],
})
export class ContentModule {}
