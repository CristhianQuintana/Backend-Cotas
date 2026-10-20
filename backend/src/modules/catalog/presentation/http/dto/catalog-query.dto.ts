import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CatalogQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ example: '3' })
  @IsOptional()
  @Matches(/^[0-9]{1,12}$/u)
  categoryId?: string;

  @ApiPropertyOptional({ example: 'arcane' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}

export class StreamIdParamDto {
  @ApiPropertyOptional()
  @Matches(/^[0-9]{1,12}$/u)
  streamId!: string;
}

export class SeriesIdParamDto {
  @Matches(/^[0-9]{1,12}$/u)
  seriesId!: string;
}

export class SeasonParamDto extends SeriesIdParamDto {
  @Matches(/^[0-9]{1,3}$/u)
  seasonNumber!: string;
}
