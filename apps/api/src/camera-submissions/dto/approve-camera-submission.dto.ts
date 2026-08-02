import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const STREAM_TYPES = ['IFRAME', 'HLS', 'MJPEG_SNAPSHOT', 'YOUTUBE_LIVE'] as const;
const LOCATION_TYPES = ['OUTDOOR', 'INDOOR', 'NATURE'] as const;

// Одобрение создаёт реальную Camera сразу с confidence: ESTIMATED — точные azimuth/fovAngle/
// rangeMeters админ доводит потом через уже существующий инструмент калибровки
// (/admin/cameras/:id/calibrate), а не здесь; здесь — разумные дефолты, чтобы камера появилась
// в поиске сразу, а не висела недоступной до отдельного шага калибровки.
export class ApproveCameraSubmissionDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsIn(STREAM_TYPES)
  streamType!: (typeof STREAM_TYPES)[number];

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
  @Max(359.999)
  azimuth?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(360)
  fovAngle?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  rangeMeters?: number;

  @IsOptional()
  @IsString()
  cityId?: string;

  // Камери всередині приміщень (див. doc/README.md) — по умолчанию OUTDOOR; AI-подсказка
  // (см. POST .../ai-suggest) может предложить INDOOR, но решение всегда принимает админ.
  @IsOptional()
  @IsIn(LOCATION_TYPES)
  locationType?: (typeof LOCATION_TYPES)[number];
}
