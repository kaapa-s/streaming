import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guards';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.strategy';
import { CreateRoomDto } from './dto/rooms.dto';
import { RoomsService } from './rooms.service';

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Post()
  create(@Body() body: CreateRoomDto, @CurrentUser() user: AuthUser) {
    return this.rooms.create(body.slug, user);
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.rooms.findBySlug(slug);
  }

  @Post(':id/join')
  joinById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    // UUID → by id; otherwise treat as slug for studio UX (?room=main).
    if (isUuid(id)) return this.rooms.joinById(id, user);
    return this.rooms.joinBySlug(id, user);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
