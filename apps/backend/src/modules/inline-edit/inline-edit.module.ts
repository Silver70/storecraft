import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InlineEditScriptController } from './inline-edit-script.controller';
import { AdminInlineEditController } from './admin-inline-edit.controller';

@Module({
  imports: [AuthModule],
  controllers: [InlineEditScriptController, AdminInlineEditController],
})
export class InlineEditModule {}
