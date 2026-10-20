import { IsString, IsOptional, IsEmail, Matches } from 'class-validator';

export class UpdateAdminProfileDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:0\d{10}|0\d{3}-\d{7})?$/, {
    message: 'Phone number cannot be greater than 11 digits and must follow 03XXXXXXXXX or 03XX-XXXXXXX format.',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
