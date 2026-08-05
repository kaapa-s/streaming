import { IsOptional, IsString, MinLength } from 'class-validator';

export class WarmupDto {
  @IsString()
  @MinLength(1)
  declare token: string;

  @IsOptional()
  @IsString()
  resolution?: string;
}

export class GoLiveDto {
  @IsOptional()
  @IsString()
  rtmpUrl?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  /** Fresh compositor join token if resolution changed or re-warmup needed. */
  @IsOptional()
  @IsString()
  token?: string;
}

export class UploadDto {
  @IsString()
  @MinLength(8)
  declare putUrl: string;
}
