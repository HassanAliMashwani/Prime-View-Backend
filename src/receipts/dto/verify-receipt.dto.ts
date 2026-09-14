import { IsString, IsOptional } from 'class-validator';

export class VerifyReceiptDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
