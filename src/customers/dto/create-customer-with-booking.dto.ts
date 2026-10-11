import { IsString, IsNotEmpty, IsOptional, ValidateNested, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { InstallmentPlanDto } from '../../plots/dto/book-plot.dto';

export class CreateCustomerWithBookingDto {
  @IsString()
  @IsNotEmpty()
  plotId: string;

  @IsString()
  @IsNotEmpty()
  paymentType: 'one_time' | 'installment';

  @IsString()
  @IsNotEmpty()
  membershipNo: string;

  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsNotEmpty()
  fatherOrHusbandName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'CNIC must be exactly 13 digits in 00000-0000000-0 format.',
  })
  cnic: string;

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
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'Nominee CNIC must be exactly 13 digits in 00000-0000000-0 format.',
  })
  nokCnic: string;

  @ValidateNested()
  @Type(() => InstallmentPlanDto)
  @IsOptional()
  installmentPlan?: InstallmentPlanDto;

  @IsString()
  @IsOptional()
  portalPassword?: string;

  @IsString()
  @IsOptional()
  paperInstallmentRef?: string;

  @IsString()
  @IsOptional()
  lockToken?: string;

  @IsString()
  @IsOptional()
  reservationId?: string;

  @IsString()
  @IsOptional()
  applicantPhotoUrl?: string;

  @IsString()
  @IsOptional()
  cnicCopyUrl?: string;

  @IsString()
  @IsOptional()
  nokCnicCopyUrl?: string;
}
