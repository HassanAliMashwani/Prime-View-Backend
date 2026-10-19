import { IsOptional, IsString, IsEmail, Matches } from 'class-validator';

export class UpdateCustomerProfileDto {
  @IsOptional()
  @IsString()
  @Matches(/^(?:0\d{10}|0\d{3}-\d{7})$/, {
    message: 'Phone number cannot be greater than 11 digits and must follow 03XXXXXXXXX or 03XX-XXXXXXX format.',
  })
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
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'Nominee CNIC must be exactly 13 digits in 00000-0000000-0 format.',
  })
  nokCnic?: string;

  @IsOptional()
  @IsString()
  applicantPhotoUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'CNIC must be exactly 13 digits in 00000-0000000-0 format.',
  })
  cnic?: string;
}
