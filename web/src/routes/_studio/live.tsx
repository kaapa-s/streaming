import { createFileRoute, useBlocker, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { CommentsPanel } from '../../components/studio/CommentsPanel';
import { GoLiveModal } from '../../components/studio/GoLiveModal';
import { InviteModal } from '../../components/studio/InviteModal';
import { RecordingFinishedModal } from '../../components/studio/RecordingFinishedModal';
import { SceneStrip } from '../../components/studio/SceneStrip';
import { StudioHeader } from '../../components/studio/StudioHeader';
import { useLocalStorageState } from '../../hooks/useLocalStorageState';
import { discardRoom } from '../../lib/auth';
import { SESSION_NAME_KEY } from '../../lib/sessionName';
import { ensureLiveSession } from '../../studio/studioStage';
import { useStudio } from '../../studio/useStudio';

export const Route = createFileRoute('/_studio/live')({
  beforeLoad: ({ context }) => {
    ensureLiveSession(context.studioHandle);
  },
  component: LivePage,
});

function LivePage() {
  const s = useStudio();
  const navigate = useNavigate();
  const [sessionName] = useLocalStorageState(SESSION_NAME_KEY, 'Studio session');
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [discardError, setDiscardError] = useState('');

  const discard = () => {
    if (!window.confirm(`Discard ${s.roomName ?? sessionName}? This permanently deletes the room and its invites.`)) return;
    void (async () => {
      try {
        await discardRoom(s.room);
        await s.leave();
        await navigate({ to: '/dashboard', search: { room: '' } });
      } catch (error) {
        setDiscardError(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  const activeSessionRef = useRef(false);
  activeSessionRef.current = s.recording || s.live;

  // Block in-app navigation away from /live during an active session
  useBlocker({
    // useBlocker enables beforeunload by default; only warn while recording/live
    enableBeforeUnload: () => activeSessionRef.current,
    shouldBlockFn: ({ next }) => {
      if (!activeSessionRef.current) return false;
      if (next.pathname === '/live') return false;
      const confirmed = window.confirm(
        'You have an active recording session. Are you sure you want to leave?',
      );
      if (confirmed) {
        void s.leave();
      }
      return !confirmed;
    },
  });

  const liveToYoutube = s.live && s.liveDestinations.includes('youtube');

  const leaveToSessions = () => {
    void (async () => {
      await s.leave();
      await navigate({ to: '/', search: { room: '' } });
    })();
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-surface text-ink">
      <StudioHeader
        sessionName={s.roomName || sessionName || 'Studio session'}
        roomStatus={s.roomStatus}
        isRoomOwner={s.isRoomOwner}
        onDiscard={discard}
        recording={s.recording}
        live={s.live}
        recordingPending={s.recordingPending}
        onStartRecording={s.startRecording}
        onStop={s.stopRecording}
        onOpenGoLive={() => setGoLiveOpen(true)}
        onOpenInvites={() => setInviteOpen(true)}
        onLeaveSessions={leaveToSessions}
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

          {liveToYoutube && s.canComment && (
            <CommentsPanel
              provider={s.commentProvider}
              capabilities={s.commentCapabilities}
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
              actionPendingId={s.commentActionPendingId}
              onRemove={s.removeComment}
              onBan={s.banCommentAuthor}
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
          onToggleCamera={s.toggleCamera}
          onToggleMicrophone={s.toggleMicrophone}
          cameraPreset={s.cameraPreset}
          sceneScreenIds={s.sceneScreenIds}
          sceneCameraIds={s.sceneCameraIds}
          canEditLayout={s.isRoomOwner}
          participants={s.participants}
          participantPendingId={s.participantPendingId}
          participantError={s.participantError}
          onToggleParticipantScene={s.toggleParticipantScene}
          onKickParticipant={s.kickParticipant}
          onCameraPreset={s.setCameraPreset}
          onToggleSceneScreen={s.toggleSceneScreen}
        />
      </div>

      <footer className="px-5 py-2.5 min-h-10 text-sm text-ink-muted border-t border-border">
        {(s.error || discardError) && <span className="text-danger">{s.error || discardError}</span>}
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

      {inviteOpen && <InviteModal slug={s.room} onClose={() => setInviteOpen(false)} />}

      {s.finishedRecording && (
        <RecordingFinishedModal
          recording={s.finishedRecording}
          onClose={() => s.setFinishedRecording(null)}
        />
      )}
    </div>
  );
}
