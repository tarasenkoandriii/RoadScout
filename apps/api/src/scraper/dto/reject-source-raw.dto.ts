import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectSourceRawDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
