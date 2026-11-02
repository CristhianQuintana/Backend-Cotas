import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const LEAD = [5, 10, 15, 30, 60] as const;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;

export class CreateAccountReminderDto {
  @ApiProperty({ example: '12345' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  channelId!: string;

  @ApiProperty({ example: 'Canal X' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  channelName!: string;

  @ApiProperty({ example: 'Noticiero' })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  programTitle!: string;

  @ApiProperty({ enum: LEAD })
  @Type(() => Number)
  @IsInt()
  @IsIn([...LEAD])
  leadMinutes!: number;

  @ApiPropertyOptional({ example: 'abc' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  epgProgramId?: string;

  @ApiPropertyOptional({ example: '2026-11-02T20:00:00.000Z' })
  @IsOptional()
  @Matches(ISO_UTC)
  startAt?: string;

  @ApiPropertyOptional({ example: '2026-11-02T21:00:00.000Z' })
  @IsOptional()
  @Matches(ISO_UTC)
  endAt?: string;
}

export class PatchAccountReminderDto {
  @ApiProperty({ enum: LEAD })
  @Type(() => Number)
  @IsInt()
  @IsIn([...LEAD])
  leadMinutes!: number;
}

export class AccountReminderIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}
