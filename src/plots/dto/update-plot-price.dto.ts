import { IsNotEmpty, IsNumber, Min } from 'class-validator';

export class UpdatePlotPriceDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price: number;
}
