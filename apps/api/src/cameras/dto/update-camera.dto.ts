import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { CreateCameraDto } from './create-camera.dto';

export class UpdateCameraDto extends PartialType(CreateCameraDto) {}

const CONFIDENCE_VALUES = ['VERIFIED', 'ESTIMATED'] as const;
const STATUS_VALUES = ['ONLINE', 'DELAYED', 'OFFLINE', 'DISABLED_SECURITY', 'UNKNOWN'] as const;

const LOCATION_TYPE_VALUES = ['OUTDOOR', 'INDOOR', 'NATURE'] as const;
const STREAM_TYPE_VALUES = ['IFRAME', 'HLS', 'MJPEG_SNAPSHOT', 'YOUTUBE_LIVE'] as const;

// Used by the admin calibration tool (5.1 in the ТЗ): saving here always
// flips confidence to VERIFIED, see CamerasService.calibrate().
export class CalibrateCameraDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsNumber()
  @Min(0)
  @Max(360)
  azimuth!: number;

  @IsNumber()
  @Min(1)
  @Max(360)
  fovAngle!: number;

  @IsNumber()
  @Min(10)
  @Max(2000)
  rangeMeters!: number;

  // Камеры внутри помещений (см. doc/README.md) — необязательное поле: если не передано,
  // CamerasService.calibrate() не трогает уже сохранённое значение locationType.
  @IsOptional()
  @IsIn(LOCATION_TYPE_VALUES)
  locationType?: (typeof LOCATION_TYPE_VALUES)[number];

  // Реальный найденный инцидент (см. doc/AUDIT-embed-bare-url-fix.md) — камера "Шулявка
  // реконструкція" получила неверный streamType при ручном резолве в очереди ревью (форма не
  // подсказывала правильный тип по ссылке), и до этого поля исправить это можно было только
  // напрямую в БД. Оба поля необязательные — если не переданы, calibrate() не трогает уже
  // сохранённые значения.
  @IsOptional()
  streamUrl?: string;

  @IsOptional()
  @IsIn(STREAM_TYPE_VALUES)
  streamType?: (typeof STREAM_TYPE_VALUES)[number];
}

export class SetStatusDto {
  @IsIn(STATUS_VALUES)
  status!: (typeof STATUS_VALUES)[number];
}

export class SetConfidenceDto {
  @IsIn(CONFIDENCE_VALUES)
  confidence!: (typeof CONFIDENCE_VALUES)[number];
}
