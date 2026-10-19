import { IsString, IsNotEmpty, IsOptional, ValidateNested, Matches, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { InstallmentPlanDto } from '../../plots/dto/book-plot.dto';

export class CompleteRegistrationDto {
  @IsString()
  @IsNotEmpty()
  membershipNo: string;

  @IsString()
  @IsNotEmpty()
  fatherOrHusbandName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0\d{10}|0\d{3}-\d{7})$/, {
    message: 'Phone number cannot be greater than 11 digits and must follow 03XXXXXXXXX or 03XX-XXXXXXX format.',
  })
  phone: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  mailingAddress: string;

  @IsString()
  @IsNotEmpty()
  nokName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'Nominee CNIC must be exactly 13 digits in 00000-0000000-0 format.',
  })
  nokCnic: string;

  @IsString()
  @IsNotEmpty()
  paymentType: 'one_time' | 'installment';

  @IsString()
  @IsOptional()
  portalPassword?: string;

  @ValidateNested()
  @Type(() => InstallmentPlanDto)
  @IsOptional()
  installmentPlan?: InstallmentPlanDto;

  @IsString()
  @IsOptional()
  paperInstallmentRef?: string;

  @IsString()
  @IsOptional()
  applicantPhotoUrl?: string;

  @IsString()
  @IsOptional()
  cnicCopyUrl?: string;

  @IsString()
  @IsOptional()
  nokCnicCopyUrl?: string;

  @IsString()
  @IsOptional()
  bookingId?: string;

  @IsString()
  @IsOptional()
  plotId?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'CNIC must be exactly 13 digits in 00000-0000000-0 format.',
  })
  cnic?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  plotPrice?: number;
}
