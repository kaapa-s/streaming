import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

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
  @IsArray()
  @IsString({ each: true })
  rtmpUrls?: string[];

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

export class OverlayPayloadDto {
  @IsString()
  @MinLength(1)
  declare author: string;

  @IsString()
  @MinLength(1)
  declare text: string;

  @IsNumber()
  declare until: number;
}

export class SetOverlayDto {
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => OverlayPayloadDto)
  declare overlay: OverlayPayloadDto | null;
}

export class SetLayoutDto {
  @IsIn(['focus', 'pip-left', 'pip-right', 'grid'])
  declare cameraPreset: 'focus' | 'pip-left' | 'pip-right' | 'grid';

  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(1)
  declare featuredId: string | null;

  @IsArray()
  @IsString({ each: true })
  declare sceneScreenIds: string[];

  /** Program cameras; omitted by legacy clients means every live camera. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sceneCameraIds?: string[];
}
