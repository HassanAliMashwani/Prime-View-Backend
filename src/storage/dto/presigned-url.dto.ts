import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class PresignedUrlDto {
  @IsString()
  @IsNotEmpty()
  bucket: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  fileType: string;

  @IsNumber()
  @Min(1)
  fileSizeKb: number;
}
