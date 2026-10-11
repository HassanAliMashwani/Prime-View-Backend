import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';

export class CreateMinimalBookingDto {
  @IsString()
  @IsNotEmpty()
  plotId: string;

  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'CNIC must be exactly 13 digits in 00000-0000000-0 format.',
  })
  cnic: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsOptional()
  lockToken?: string;

  @IsString()
  @IsOptional()
  reservationId?: string;
}
