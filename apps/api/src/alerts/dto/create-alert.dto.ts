import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const ALERT_TYPES = ['CAMERA_STATUS', 'AREA_INCIDENT'] as const;

export class CreateAlertDto {
  @IsIn(ALERT_TYPES)
  type!: (typeof ALERT_TYPES)[number];

  // Для CAMERA_STATUS
  @IsOptional()
  @IsString()
  cameraId?: string;

  // Для AREA_INCIDENT
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(20000)
  radiusMeters?: number;

  @IsString()
  @MaxLength(200)
  label!: string;
}
