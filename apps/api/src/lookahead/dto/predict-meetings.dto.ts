import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class UserRoutePointDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  // Seconds from "now" — first point should normally be 0 (current position).
  @IsNumber()
  @Min(0)
  timestampOffsetSeconds!: number;
}

// Глава 17 ТЗ: "прогноз встречи" against an arbitrary user route (not just a single
// searched point — that shortcut is already built into /search and /cameras/at-point).
export class PredictMeetingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UserRoutePointDto)
  points!: UserRoutePointDto[];

  // Optional — restrict the search to specific FIXED_ROUTE cameras instead of scanning all of them.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cameraIds?: string[];
}
