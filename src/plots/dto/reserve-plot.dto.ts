import { IsString, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';

export class ReservePlotDto {
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @IsNotEmpty()
  customerPhone: string;

  @IsString()
  @IsOptional()
  customerEmail?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  tokenFee?: number;

  @IsNumber()
  @IsOptional()
  validDays?: number;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  customerId?: string;
}
