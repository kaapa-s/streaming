import { createFileRoute, useBlocker, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { CommentsPanel } from '../../../components/studio/CommentsPanel';
import { GoLiveModal } from '../../../components/studio/GoLiveModal';
import { RecordingFinishedModal } from '../../../components/studio/RecordingFinishedModal';
import { SceneStrip } from '../../../components/studio/SceneStrip';
import { StudioHeader } from '../../../components/studio/StudioHeader';
import { ensureLiveSession } from '../../../studio/studioStage';
import { useStudio } from '../../../studio/useStudio';

export const Route = createFileRoute('/r/$slug/live')({
  beforeLoad: ({ context, params, location }) => {
    ensureLiveSession(context.studioHandle, params.slug, location.href);
  },
  component: LivePage,
});

function LivePage() {
  const { slug } = Route.useParams();
  const s = useStudio();
  const navigate = useNavigate();
  const [goLiveOpen, setGoLiveOpen] = useState(false);

  const activeSessionRef = useRef(false);
  activeSessionRef.current = s.recording || s.live;

  // Block in-app navigation away from the studio during an active session
  useBlocker({
    // useBlocker enables beforeunload by default; only warn while recording/live
    enableBeforeUnload: () => activeSessionRef.current,
    shouldBlockFn: ({ next }) => {
      if (!activeSessionRef.current) return false;
      if (next.pathname === `/r/${slug}/live`) return false;
      const confirmed = window.confirm(
        'You have an active recording session. Are you sure you want to leave?',
      );
      if (confirmed) {
        void s.leave();
      }
      return !confirmed;
    },
  });

  if (!s.user) return null;

  const liveToYoutube = s.live && s.liveDestinations.includes('youtube');
  const inviteUrl = `${location.origin}/r/${slug}`;

  // Just navigate: useBlocker above intercepts this while recording/live, and
  // unmounting the room layout tears the session down. Calling leave() first
  // would flip `joined` and let the route guard redirect us to the pre-join
  // screen before this navigation lands.
  const leaveToSessions = () => {
    void navigate({ to: '/new' });
  };

  // Owner only: closes the room for everyone and frees the compositor slot.
  const endStream = () => {
    if (!window.confirm('End this stream for everyone? The invite link will stop working.')) {
      return;
    }
    void (async () => {
      await s.endStream();
      await navigate({ to: '/new' });
    })();
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-surface text-ink">
      <StudioHeader
        sessionName={s.roomTitle || 'Studio session'}
        recording={s.recording}
        live={s.live}
        recordingPending={s.recordingPending}
        onStartRecording={s.startRecording}
        onStop={s.stopRecording}
        onOpenGoLive={() => setGoLiveOpen(true)}
        onLeaveSessions={leaveToSessions}
        isOwner={s.isRoomOwner}
        inviteUrl={inviteUrl}
        onEndStream={endStream}
        endPending={s.endPending}
      />

      <div className="flex-1 flex flex-col min-h-0">
        <div
          className={`flex-1 grid gap-4 p-5 min-h-0 ${
            s.live && liveToYoutube
              ? 'grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]'
              : 'grid-cols-1'
          }`}
        >
          <section className="min-w-0 min-h-0 flex flex-col overflow-hidden">
            <h2 className="text-xs font-semibold tracking-[0.12em] uppercase text-ink-subtle mb-2.5 shrink-0">
              Program preview
            </h2>
            <div className="preview-viewport">
              <div
                className="preview preview-fit rounded-xl overflow-hidden border border-border bg-black"
                ref={s.previewRef}
              />
            </div>
          </section>

          {liveToYoutube && (
            <CommentsPanel
              isOwner={s.isRoomOwner}
              youtubeConnected={s.platforms.youtube.connected}
              live={liveToYoutube}
              sessionActive={s.commentsSessionActive}
              sessionTitle={s.commentsSessionTitle}
              bindFailed={s.commentsBindFailed}
              comments={s.comments}
              replyText={s.replyText}
              onReplyTextChange={s.setReplyText}
              replyPending={s.replyPending}
              onSendReply={s.sendReply}
              pinnedCommentId={s.pinnedCommentId}
              onPin={s.pinComment}
              onClearOverlay={s.clearOverlay}
            />
          )}
        </div>

        <SceneStrip
          localStream={s.localStream}
          localScreenStream={s.localScreenStream}
          localPeerId={s.localPeerId}
          remotePeers={s.remotePeers}
          screenPending={s.screenPending}
          onToggleScreenShare={s.toggleScreenShare}
          onRemoveLocalScreen={s.stopScreenShare}
          cameraPreset={s.cameraPreset}
          featuredId={s.featuredId}
          sceneScreenIds={s.sceneScreenIds}
          canEditLayout={s.isRoomOwner}
          onCameraPreset={s.setCameraPreset}
          onFeature={s.setFeatured}
          onToggleSceneScreen={s.toggleSceneScreen}
          onRemovePeer={s.isRoomOwner ? s.kickUser : undefined}
        />
      </div>

      <footer className="px-5 py-2.5 min-h-10 text-sm text-ink-muted border-t border-border">
        {s.error && <span className="text-danger">{s.error}</span>}
        {!s.error && s.recordingInfo && <span>{s.recordingInfo}</span>}
        {!s.error && !s.recordingInfo && !s.recording && <span>Ready · 1080p60</span>}
      </footer>

      {goLiveOpen && (
        <GoLiveModal
          platforms={s.platforms}
          streamKeys={s.streamKeys}
          pending={s.recordingPending}
          onClose={() => setGoLiveOpen(false)}
          onGoLive={(destinations) => {
            s.goLive(destinations);
            setGoLiveOpen(false);
          }}
        />
      )}

      {s.finishedRecording && (
        <RecordingFinishedModal
          recording={s.finishedRecording}
          onClose={() => s.setFinishedRecording(null)}
        />
      )}
    </div>
  );
}
