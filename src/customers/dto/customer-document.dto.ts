import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { DocumentType } from '@prisma/client';

export class UploadCustomerDocumentDto {
  @IsEnum(DocumentType)
  @IsNotEmpty()
  type: DocumentType;

  @IsString()
  @IsOptional()
  label?: string;

  @IsString()
  @IsNotEmpty()
  fileUrl: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsNumber()
  @IsOptional()
  fileSizeKb?: number;

  @IsString()
  @IsOptional()
  bookingId?: string;
}
