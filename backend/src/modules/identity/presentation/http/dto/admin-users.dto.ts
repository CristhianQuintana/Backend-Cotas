import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class AdminUserListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class CreateAdminUserDto {
  @ApiProperty({ example: 'operador' })
  @IsString()
  @Length(3, 64)
  @Matches(/^[a-zA-Z0-9._-]+$/u)
  username!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128)
  password!: string;

  @ApiProperty({ enum: ['CUSTOMER', 'OPERATOR', 'ADMIN'] })
  @IsIn(['CUSTOMER', 'OPERATOR', 'ADMIN'])
  role!: 'CUSTOMER' | 'OPERATOR' | 'ADMIN';

  @ApiPropertyOptional({ enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED'])
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
}

export class UpdateAdminUserDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED'] })
  @IsOptional()
  @IsIn(['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED'])
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

  @ApiPropertyOptional({ enum: ['CUSTOMER', 'OPERATOR', 'ADMIN'] })
  @IsOptional()
  @IsIn(['CUSTOMER', 'OPERATOR', 'ADMIN'])
  role?: 'CUSTOMER' | 'OPERATOR' | 'ADMIN';
}

export class ResetAdminUserPasswordDto {
  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128)
  password!: string;
}

export class AdminUserIdParamDto {
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu)
  id!: string;
}
