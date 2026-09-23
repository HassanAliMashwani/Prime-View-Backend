import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetAdminPasswordDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  newPassword: string;
}
