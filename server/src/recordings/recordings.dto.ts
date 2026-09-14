import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { PLATFORM_PROVIDERS, type PlatformProvider } from '../platforms/platform-ids';

export class StartRecordingDestinationDto {
  @IsIn(PLATFORM_PROVIDERS)
  declare platform: PlatformProvider;

  @IsString()
  @MinLength(1)
  declare streamKey: string;
}

export class StartRecordingDto {
  @IsOptional()
  @IsString()
  room?: string;

  /** @deprecated Prefer `destinations`. Treated as a YouTube stream key. */
  @IsOptional()
  @IsString()
  rtmpUrl?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StartRecordingDestinationDto)
  destinations?: StartRecordingDestinationDto[];

  @IsOptional()
  @IsString()
  resolution?: string;
}

export class StopRecordingDto {
  @IsOptional()
  @IsString()
  room?: string;
}
