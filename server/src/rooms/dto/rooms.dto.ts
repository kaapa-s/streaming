import {
  IsArray,
  IsIn,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CAMERA_PRESETS, type CameraPreset } from '../room-layout';

export class CreateRoomDto {
  @IsString()
  @MinLength(1)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'slug must be alphanumeric, hyphen, or underscore',
  })
  declare slug: string;
}

export class SetLayoutDto {
  @IsIn(CAMERA_PRESETS)
  declare cameraPreset: CameraPreset;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(1)
  declare featuredId: string | null;

  @IsArray()
  @IsString({ each: true })
  declare sceneScreenIds: string[];
}
