import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangeAdminPasswordDto {
  @IsNotEmpty()
  @IsString()
  oldPassword: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  newPassword: string;
}
