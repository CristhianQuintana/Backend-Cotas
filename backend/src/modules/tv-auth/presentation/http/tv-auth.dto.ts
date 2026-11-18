import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreateTvQrSessionDto {
  @ApiProperty({
    description: 'Identificador estable de instalación del televisor (UUID recomendado).',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @IsString()
  @Length(8, 128)
  @Matches(/^[0-9A-Za-z._:-]+$/u)
  deviceId!: string;

  @ApiPropertyOptional({ example: 'android-tv' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  @Matches(/^[0-9A-Za-z._ -]+$/u)
  platform?: string;

  @ApiPropertyOptional({
    example: 'Sala - Sony Bravia',
    description: 'Nombre que verá el usuario en el teléfono al confirmar.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  deviceName?: string;
}

export class TvQrSessionParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sessionId!: string;
}

export class TvQrCodeBodyDto {
  @ApiProperty({
    description: 'Código temporal del QR (fragmento `#c=` de la URL de autorización).',
  })
  @IsString()
  @Length(16, 128)
  @Matches(/^[0-9A-Za-z_-]+$/u)
  code!: string;
}

export class TvQrIdentifyDto extends TvQrCodeBodyDto {
  @ApiProperty({ description: 'ID token de Google Sign-In (mismo formato que POST /auth/google).' })
  @IsString()
  @Length(20, 8192)
  idToken!: string;
}
