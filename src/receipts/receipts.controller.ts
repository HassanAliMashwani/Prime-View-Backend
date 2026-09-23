import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionScopeGuard } from '../auth/guards/permission-scope.guard';
import { CurrentSession } from '../common/decorators/current-session.decorator';
import { SubmitReceiptDto } from './dto/submit-receipt.dto';
import { VerifyReceiptDto } from './dto/verify-receipt.dto';
import { RejectReceiptDto } from './dto/reject-receipt.dto';
import { Public } from '../auth/decorators/public.decorator';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';

@Controller('receipts')
@UseGuards(JwtAuthGuard, PermissionScopeGuard)
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async submitReceipt(
    @Body() dto: SubmitReceiptDto,
    @CurrentSession() session: any,
  ) {
    return this.receiptsService.submitPaymentReceipt(dto, session);
  }

  @Get()
  async getAdminReceipts(
    @Query('status') status: string,
    @CurrentSession() session: any,
  ) {
    return this.receiptsService.getAdminReceipts(status, session);
  }

  @Get('me')
  async getCustomerReceipts(@CurrentSession() session: any) {
    return this.receiptsService.getCustomerReceipts(session);
  }

  @Get('balloon-preview')
  async getBalloonPreview(
    @Query('bookingId') bookingId: string,
    @Query('amount') amount: string,
    @CurrentSession() session: any,
  ) {
    return this.receiptsService.getBalloonPreview(bookingId, amount, session);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  async verifyReceipt(
    @Param('id') id: string,
    @Body() dto: VerifyReceiptDto,
    @CurrentSession() session: any,
  ) {
    return this.receiptsService.verifyReceipt(id, dto, session);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectReceipt(
    @Param('id') id: string,
    @Body() dto: RejectReceiptDto,
    @CurrentSession() session: any,
  ) {
    return this.receiptsService.rejectReceipt(id, dto, session);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get('verify/:slipNumber')
  async publicVerifySlip(@Param('slipNumber') slipNumber: string) {
    return this.receiptsService.publicVerifySlip(slipNumber);
  }
}
