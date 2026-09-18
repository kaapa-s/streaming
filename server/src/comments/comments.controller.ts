import { Body, Controller, Param, Post, Sse, UseGuards } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/auth.guards';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.strategy';
import { CommentsService } from './comments.service';
import {
  BanCommentAuthorDto,
  RemoveCommentDto,
  ReplyCommentDto,
  SetOverlayDto,
} from './dto';

@Controller('rooms/:slug')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Post('comments/session')
  startSession(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    return this.comments.startSession(slug, user);
  }

  @Sse('comments/stream')
  stream(@Param('slug') slug: string, @CurrentUser() user: AuthUser): Observable<MessageEvent> {
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

  @Post('comments/remove')
  remove(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthUser,
    @Body() body: RemoveCommentDto,
  ) {
    return this.comments.removeComment(slug, user, body.commentId);
  }

  @Post('comments/ban')
  ban(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthUser,
    @Body() body: BanCommentAuthorDto,
  ) {
    return this.comments.banAuthor(slug, user, body.authorId, body.durationSeconds);
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
