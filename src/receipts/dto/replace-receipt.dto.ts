import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';

export class ReplaceReceiptDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsIn(['administrative_error', 'duplicate_receipt'], {
    message: 'reasonCode must be either administrative_error or duplicate_receipt',
  })
  reasonCode: string;

  @IsString()
  @IsOptional()
  correctionNotes?: string;
}
