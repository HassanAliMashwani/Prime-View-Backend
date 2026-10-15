import { IsString, IsNotEmpty, IsIn } from 'class-validator';

export class CancelReceiptDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsIn(['administrative_error', 'duplicate_receipt'], {
    message: 'reasonCode must be either administrative_error or duplicate_receipt',
  })
  reasonCode: string;
}
