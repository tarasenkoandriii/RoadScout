import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class LivePositionDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  speedMps?: number;
}
