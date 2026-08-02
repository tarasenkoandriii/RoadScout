import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const STREAM_TYPES = ['IFRAME', 'HLS', 'MJPEG_SNAPSHOT', 'YOUTUBE_LIVE'] as const;
const MOBILITY_TYPES = ['STATIONARY', 'FIXED_ROUTE'] as const;
const ROUTE_MODES = ['LOOP', 'TIMETABLE', 'LIVE_GPS'] as const;

// Глава 16 ТЗ: routeGeometry is a LineString given as an ordered array of {lat,lng}.
class RoutePointDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}

// TIMETABLE only — { "departures": ["06:20", "06:50", ...] }, daily local-time.
class RouteScheduleDto {
  @IsArray()
  @IsString({ each: true })
  departures!: string[];
}

export class CreateCameraDto {
  @IsString()
  name!: string;

  @IsString()
  providerId!: string;

  @IsString()
  streamUrl!: string;

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

  @IsOptional()
  @IsNumber()
  heightMeters?: number;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Поддержка городов Украины (см. doc/README.md) — id из справочника City. Опционально
  // (nullable в схеме) для обратной совместимости со старыми камерами до введения мульти-city.
  @IsOptional()
  @IsString()
  cityId?: string;

  // --- Глава 16–18 ТЗ: FIXED_ROUTE ---

  @IsOptional()
  @IsIn(MOBILITY_TYPES)
  mobilityType?: (typeof MOBILITY_TYPES)[number];

  // Required (validated in CamerasService.create, not here — class-validator's @ValidateIf
  // can't easily express "required iff mobilityType === FIXED_ROUTE" across sibling fields
  // combined with nested-array validation) when mobilityType is FIXED_ROUTE.
  @IsOptional()
  @ValidateIf((o) => o.routeGeometry !== undefined)
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => RoutePointDto)
  routeGeometry?: RoutePointDto[];

  @IsOptional()
  @IsIn(ROUTE_MODES)
  routeMode?: (typeof ROUTE_MODES)[number];

  @IsOptional()
  @ValidateIf((o) => o.routeSchedule !== undefined)
  @ValidateNested()
  @Type(() => RouteScheduleDto)
  routeSchedule?: RouteScheduleDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  averageSpeed?: number;

  @IsOptional()
  @IsString() // ISO datetime string — parsed to Date in CamerasService.create
  routeStartedAt?: string;
}
