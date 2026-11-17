import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';

export class LoginRequestDto {
  @ApiProperty({
    example: 'viewer.demo',
    description:
      'Usuario IPTV/XUI o correo de cuenta COTAS. Si contiene @ se trata como email local.',
    minLength: 3,
    maxLength: 254,
  })
  @IsString()
  @Length(3, 254)
  @Matches(/^[a-zA-Z0-9._@+-]+$/u)
  username!: string;

  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiPropertyOptional({
    description:
      'Identificador estable del aparato (UUID o id de instalación). Recomendado en apps IPTV; si falta se usa el User-Agent.',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @IsOptional()
  @IsString()
  @Length(8, 128)
  @Matches(/^[0-9A-Za-z._:-]+$/u)
  deviceId?: string;

  @ApiPropertyOptional({
    description: 'Plataforma del cliente. Valores desconocidos se tratan como other.',
    example: 'android',
  })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  @Matches(/^[0-9A-Za-z._ -]+$/u)
  platform?: string;

  @ApiPropertyOptional({ example: 'Samsung TV sala' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  deviceName?: string;

  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{6}$/u)
  totpCode?: string;

  @ApiPropertyOptional({ example: 'abcde-fghij' })
  @IsOptional()
  @IsString()
  @Length(8, 32)
  recoveryCode?: string;
}

export class RefreshRequestDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  refreshToken!: string;
}

export class GoogleLoginRequestDto {
  @ApiProperty({ description: 'Google ID token (JWT) emitido por GIS / Google Sign-In' })
  @IsString()
  @Length(40, 8_000)
  idToken!: string;

  @ApiPropertyOptional({ description: 'Solo para POST /auth/google/link' })
  @ValidateIf((body: GoogleLoginRequestDto) => typeof body.password === 'string')
  @IsOptional()
  @IsString()
  @Length(1, 128)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(8, 128)
  @Matches(/^[0-9A-Za-z._:-]+$/u)
  deviceId?: string;

  @ApiPropertyOptional({ example: 'android' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  platform?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  deviceName?: string;
}

export class RegisterEmailRequestDto {
  @ApiProperty({ example: 'usuario@correo.com' })
  @IsEmail()
  @Length(5, 254)
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(8, 128)
  deviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 32)
  platform?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  deviceName?: string;
}

export class ConfirmMfaRequestDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^[0-9]{6}$/u)
  totpCode!: string;
}

export class SessionIdParamDto {
  @ApiProperty()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu)
  id!: string;
}
