import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class SubmitCameraDto {
  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  streamUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  suggestedName?: string;

  @IsOptional()
  @IsString()
  cityId?: string;

  // Свободный текст адреса — геокодируется при подаче (см. CameraSubmissionsService), лучше
  // всего работает вместе с cityId (та же подсказка города, что и в обычном поиске).
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
