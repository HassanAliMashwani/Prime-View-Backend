import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionScopeGuard } from '../auth/guards/permission-scope.guard';

@Controller('jobs')
@UseGuards(JwtAuthGuard, PermissionScopeGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post('receipt-file')
  @HttpCode(HttpStatus.ACCEPTED)
  async enqueueReceiptFileProcessing(@Body() body: any) {
    const job = await this.jobsService.enqueueJob('receipt_file_processing', body);
    return {
      accepted: true,
      message: 'Receipt file processing job accepted into background queue.',
      jobId: job.id,
      status: job.status,
    };
  }

  @Post('notices')
  @HttpCode(HttpStatus.ACCEPTED)
  async enqueueNoticeSending(@Body() body: any) {
    const job = await this.jobsService.enqueueJob('notice_sending', body);
    return {
      accepted: true,
      message: 'Notice sending job accepted into background queue.',
      jobId: job.id,
      status: job.status,
    };
  }

  @Post('reports')
  @HttpCode(HttpStatus.ACCEPTED)
  async enqueueHeavyReport(@Body() body: any) {
    const job = await this.jobsService.enqueueJob('heavy_report', body);
    return {
      accepted: true,
      message: 'Heavy report generation job accepted into background queue.',
      jobId: job.id,
      status: job.status,
    };
  }

  @Get(':id')
  async getJobStatus(@Param('id') id: string) {
    return this.jobsService.getJob(id);
  }
}
