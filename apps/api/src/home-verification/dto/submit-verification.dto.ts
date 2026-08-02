import { IsString, MaxLength, MinLength } from 'class-validator';

// multipart/form-data: только текстовое поле здесь — сам файл квитанции обрабатывается
// отдельно через FileInterceptor/@UploadedFile() в контроллере, не через class-validator.
export class SubmitHomeVerificationDto {
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  address!: string;
}
