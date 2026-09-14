import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateMinimalBookingDto {
  @IsString()
  @IsNotEmpty()
  plotId: string;

  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @IsNotEmpty()
  cnic: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsOptional()
  lockToken?: string;
}
