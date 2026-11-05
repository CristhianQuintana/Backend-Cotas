import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateDeviceLinkSessionDto {
  @ApiProperty({
    description: 'UUID estable de instalación del TV (obligatorio).',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @IsString()
  @Length(8, 128)
  @Matches(/^[0-9A-Za-z._:-]+$/u)
  deviceId!: string;

  @ApiPropertyOptional({ example: 'tv' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  @Matches(/^[0-9A-Za-z._ -]+$/u)
  platform?: string;

  @ApiPropertyOptional({ example: 'LG Living' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  deviceName?: string;
}

export class ApproveDeviceLinkDto {
  @ApiProperty({ example: 'AB3K7N2P', description: 'Código del QR (8 caracteres).' })
  @IsString()
  @Length(8, 8)
  @Matches(/^[2-9A-HJ-NP-Z]{8}$/iu)
  linkCode!: string;

  @ApiPropertyOptional({
    example: 'cuarto02',
    description: 'Nombre visible del TV en GET /devices.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  deviceName?: string;
}

export class PollDeviceLinkQueryDto {
  @ApiProperty({
    description: 'Mismo deviceId usado al crear la sesión QR.',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @IsString()
  @Length(8, 128)
  @Matches(/^[0-9A-Za-z._:-]+$/u)
  deviceId!: string;
}

export class DeviceLinkCodeParamDto {
  @ApiProperty({ example: 'AB3K7N2P' })
  @IsString()
  @Length(8, 8)
  @Matches(/^[2-9A-HJ-NP-Z]{8}$/iu)
  code!: string;
}
