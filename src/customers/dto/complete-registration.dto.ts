import { IsString, IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
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
}
