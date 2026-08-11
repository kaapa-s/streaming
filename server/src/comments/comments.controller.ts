import {
  Body,
  Controller,
  Param,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/auth.guards';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.strategy';
import { CommentsService } from './comments.service';
import { ReplyCommentDto, SetOverlayDto, StartCommentsSessionDto } from './dto';

@Controller('rooms/:slug')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Post('comments/session')
  startSession(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthUser,
    @Body() body: StartCommentsSessionDto,
  ) {
    return this.comments.startSession(slug, user, body.videoUrl);
  }

  @Sse('comments/stream')
  stream(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthUser,
  ): Observable<MessageEvent> {
    return this.comments.streamComments(slug, user);
  }

  @Post('comments/reply')
  reply(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthUser,
    @Body() body: ReplyCommentDto,
  ) {
    return this.comments.reply(slug, user, body.text);
  }

  @Post('overlay')
  setOverlay(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthUser,
    @Body() body: SetOverlayDto,
  ) {
    return this.comments.setOverlay(slug, user, body.comment);
  }
}
