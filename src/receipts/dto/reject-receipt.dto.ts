import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class RejectReceiptDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsBoolean()
  assignStrike?: boolean;

  @IsOptional()
  @IsString()
  strikeReason?: string;
}
