import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { StorageService } from './storage.service';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { SignedViewUrlDto } from './dto/signed-view-url.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('presigned-url')
  @UseGuards(JwtAuthGuard)
  async getPresignedUploadUrl(@Body() dto: PresignedUrlDto) {
    const result = await this.storageService.generatePresignedUploadUrl(dto);
    return result;
  }

  @Get('signed-view-url')
  @UseGuards(JwtAuthGuard)
  async getSignedViewUrl(@Query() query: SignedViewUrlDto) {
    const result = await this.storageService.generateSignedViewUrl(query);
    return result;
  }

  @Post('verify-upload')
  @UseGuards(JwtAuthGuard)
  async verifyUpload(
    @Body() body: { bucket: string; key: string; expectedMimeType?: string; maxSizeBytes?: number; fileContentBase64?: string },
  ) {
    const buffer = body.fileContentBase64 ? Buffer.from(body.fileContentBase64, 'base64') : undefined;
    const result = await this.storageService.verifyUploadedObject(
      body.bucket,
      body.key,
      body.expectedMimeType,
      body.maxSizeBytes,
      buffer,
    );
    return { ok: result.valid, ...result };
  }
}
