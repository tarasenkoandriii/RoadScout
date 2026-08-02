import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectCameraSubmissionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
