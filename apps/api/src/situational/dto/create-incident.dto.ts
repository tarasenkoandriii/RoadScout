import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const INCIDENT_TYPES = ['ACCIDENT', 'ROAD_CLOSURE', 'FLOODING', 'ICE', 'FOG', 'CONSTRUCTION', 'OTHER'] as const;
const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

export class CreateIncidentDto {
  @IsIn(INCIDENT_TYPES)
  type!: (typeof INCIDENT_TYPES)[number];

  @IsOptional()
  @IsIn(INCIDENT_SEVERITIES)
  severity?: (typeof INCIDENT_SEVERITIES)[number];

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // ISO datetime string — when the situation is expected to clear on its own (e.g. planned
  // roadworks with a known end time). Optional; admins can also resolve manually at any time.
  @IsOptional()
  @IsString()
  expiresAt?: string;
}
