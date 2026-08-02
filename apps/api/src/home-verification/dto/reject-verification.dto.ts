import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectVerificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
