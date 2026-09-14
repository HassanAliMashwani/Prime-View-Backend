import { IsString, IsNotEmpty } from 'class-validator';

export class SignedViewUrlDto {
  @IsString()
  @IsNotEmpty()
  bucket: string;

  @IsString()
  @IsNotEmpty()
  key: string;
}
