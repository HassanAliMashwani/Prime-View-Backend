import { IsOptional, IsString, IsEmail } from 'class-validator';

export class UpdateCustomerProfileDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  mailingAddress?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  fatherOrHusbandName?: string;

  @IsOptional()
  @IsString()
  nokName?: string;

  @IsOptional()
  @IsString()
  nokCnic?: string;
}
