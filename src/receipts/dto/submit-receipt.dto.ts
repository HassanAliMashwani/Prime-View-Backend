import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsIn,
  Min,
} from 'class-validator';

export class SubmitReceiptDto {
  @IsString()
  @IsNotEmpty()
  plotId: string;

  @IsIn(['installment', 'one_time'])
  paymentType: 'installment' | 'one_time';

  @IsOptional()
  @IsNumber()
  installmentNumber?: number;

  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  depositoryBank?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsString()
  @IsNotEmpty()
  transactionRef: string;

  @IsString()
  @IsNotEmpty()
  paymentDate: string;

  @IsString()
  @IsNotEmpty()
  receiptFileUrl: string;

  @IsOptional()
  @IsString()
  receiptFileName?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Optional customerId for admin-assisted or direct submissions
  @IsOptional()
  @IsString()
  customerId?: string;
}
