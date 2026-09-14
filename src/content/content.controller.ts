import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ContentService } from './content.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionScopeGuard } from '../auth/guards/permission-scope.guard';
import { CurrentSession } from '../common/decorators/current-session.decorator';
import { CreateContentBlockDto } from './dto/create-content-block.dto';
import { SaveContentBlockDto } from './dto/save-content-block.dto';

@Controller('content')
@UseGuards(JwtAuthGuard, PermissionScopeGuard)
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Get()
  async getContentBlocks(@Query('section') section?: 'plans' | 'events') {
    return this.contentService.getContentBlocks(section);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createContentBlock(
    @Body() dto: CreateContentBlockDto,
    @CurrentSession() session: any,
  ) {
    return this.contentService.createContentBlock(dto, session);
  }

  // --- Lock acquisition (supports /content/:id/lock and /content/blocks/:id/lock) ---
  @Post(':id/lock')
  @HttpCode(HttpStatus.OK)
  async acquireContentLock(
    @Param('id') id: string,
    @CurrentSession() session: any,
  ) {
    return this.contentService.acquireContentLock(id, session);
  }

  @Post('blocks/:id/lock')
  @HttpCode(HttpStatus.OK)
  async acquireContentBlockLock(
    @Param('id') id: string,
    @CurrentSession() session: any,
  ) {
    return this.contentService.acquireContentLock(id, session);
  }

  // --- Lock release (supports POST and DELETE) ---
  @Post(':id/release-lock')
  @HttpCode(HttpStatus.OK)
  async releaseContentLockPost(
    @Param('id') id: string,
    @CurrentSession() session: any,
  ) {
    return this.contentService.releaseContentLock(id, session);
  }

  @Post('blocks/:id/release-lock')
  @HttpCode(HttpStatus.OK)
  async releaseContentBlockLockPost(
    @Param('id') id: string,
    @CurrentSession() session: any,
  ) {
    return this.contentService.releaseContentLock(id, session);
  }

  @Delete(':id/lock')
  @HttpCode(HttpStatus.OK)
  async releaseContentLockDelete(
    @Param('id') id: string,
    @CurrentSession() session: any,
  ) {
    return this.contentService.releaseContentLock(id, session);
  }

  @Delete('blocks/:id/lock')
  @HttpCode(HttpStatus.OK)
  async releaseContentBlockLockDelete(
    @Param('id') id: string,
    @CurrentSession() session: any,
  ) {
    return this.contentService.releaseContentLock(id, session);
  }

  // --- Save block ---
  @Post(':id/save')
  @HttpCode(HttpStatus.OK)
  async saveContentBlock(
    @Param('id') id: string,
    @Body() dto: SaveContentBlockDto,
    @CurrentSession() session: any,
  ) {
    return this.contentService.saveContentBlock(id, dto, session);
  }

  @Post('blocks/:id/save')
  @HttpCode(HttpStatus.OK)
  async saveContentBlockWithBlocksPrefix(
    @Param('id') id: string,
    @Body() dto: SaveContentBlockDto,
    @CurrentSession() session: any,
  ) {
    return this.contentService.saveContentBlock(id, dto, session);
  }

  // --- Delete block ---
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteContentBlock(
    @Param('id') id: string,
    @CurrentSession() session: any,
  ) {
    return this.contentService.deleteContentBlock(id, session);
  }

  @Delete('blocks/:id')
  @HttpCode(HttpStatus.OK)
  async deleteContentBlockWithBlocksPrefix(
    @Param('id') id: string,
    @CurrentSession() session: any,
  ) {
    return this.contentService.deleteContentBlock(id, session);
  }
}
