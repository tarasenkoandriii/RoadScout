import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const STREAM_TYPES = ['IFRAME', 'HLS', 'MJPEG_SNAPSHOT', 'YOUTUBE_LIVE'] as const;
const LOCATION_TYPES = ['OUTDOOR', 'INDOOR', 'NATURE'] as const;

// CameraSourceRaw не хранит streamType (см. doc/AUDIT-parser-import-p0-p1.2.md) — при ручном
// резолве админ выбирает его сам, тот же паттерн, что уже есть в
// ApproveCameraSubmissionDto (краудсорс-заявки камер).
export class ResolveSourceRawDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsIn(STREAM_TYPES)
  streamType!: (typeof STREAM_TYPES)[number];

  // Камеры внутри помещений (см. doc/README.md) — по умолчанию OUTDOOR; AI-подсказка
  // (см. POST .../ai-suggest) может предложить INDOOR, но решение всегда принимает админ.
  @IsOptional()
  @IsIn(LOCATION_TYPES)
  locationType?: (typeof LOCATION_TYPES)[number];

  // Один из двух вариантов: либо address (геокодируется так же, как при авто-импорте, с
  // подсказкой города источника), либо lat/lng напрямую, если админ уже знает координаты.
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

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
}
