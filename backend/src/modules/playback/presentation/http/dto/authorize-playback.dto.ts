import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class AuthorizePlaybackDto {
  @ApiProperty({ enum: ['live', 'vod', 'series'] })
  @IsIn(['live', 'vod', 'series'])
  contentType!: 'live' | 'vod' | 'series';

  @ApiProperty({ example: '1001' })
  @IsString()
  @Matches(/^[0-9]{1,12}$/u)
  streamId!: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @Matches(/^[0-9]{1,12}$/u)
  seriesId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  seasonNumber?: number;
}
