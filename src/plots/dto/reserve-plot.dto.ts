import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class ReservePlotDto {
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0\d{10}|0\d{3}-\d{7})$/, {
    message: 'Customer phone number cannot be greater than 11 digits and must follow 03XXXXXXXXX or 03XX-XXXXXXX format.',
  })
  customerPhone: string;

  @IsString()
  @IsOptional()
  customerEmail?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  tokenFee?: number;

  @IsNumber()
  @IsOptional()
  validDays?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  validHours?: number;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  customerId?: string;
}
