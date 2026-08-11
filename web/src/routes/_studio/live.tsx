import { createFileRoute } from '@tanstack/react-router';
import { CommentsPanel } from '../../components/studio/CommentsPanel';
import { RecordingFinishedModal } from '../../components/studio/RecordingFinishedModal';
import { SpeakersGrid } from '../../components/studio/SpeakersGrid';
import { StudioHeader } from '../../components/studio/StudioHeader';
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
  if (!s.user) return null;

  return (
    <div className="studio">
      <StudioHeader
        userName={s.user.name}
        rtmpUrl={s.rtmpUrl}
        onRtmpChange={s.setRtmpUrl}
        streamControlsLocked={s.streamControlsLocked}
        screenPending={s.screenPending}
        screenLabel={s.screenLabel}
        onToggleScreenShare={s.toggleScreenShare}
        recording={s.recording}
        live={s.live}
        recordingPending={s.recordingPending}
        actionLabel={s.actionLabel}
        onToggleRecording={s.toggleRecording}
        youtubeConnected={s.youtubeConnected}
        youtubeAccountLabel={s.youtubeAccountLabel}
        youtubePending={s.youtubePending}
        onConnectYoutube={s.connectYoutube}
        onDisconnectYoutube={s.disconnectYoutube}
      />

      <main>
        <div className="program-column">
          <section className="preview-section">
            <h2>Program preview</h2>
            <div className="preview" ref={s.previewRef} />
          </section>

          <CommentsPanel
            isOwner={s.isRoomOwner}
            youtubeConnected={s.youtubeConnected}
            live={s.live}
            sessionActive={s.commentsSessionActive}
            sessionTitle={s.commentsSessionTitle}
            sessionPending={s.commentsSessionPending}
            videoUrl={s.commentsVideoUrl}
            onVideoUrlChange={s.setCommentsVideoUrl}
            onStartSession={s.startCommentsSession}
            comments={s.comments}
            replyText={s.replyText}
            onReplyTextChange={s.setReplyText}
            replyPending={s.replyPending}
            onSendReply={s.sendReply}
            pinnedCommentId={s.pinnedCommentId}
            onPin={s.pinComment}
            onClearOverlay={s.clearOverlay}
          />
        </div>

        <SpeakersGrid
          localName={s.user.name}
          localStream={s.localStream}
          localScreenStream={s.localScreenStream}
          remotePeers={s.remotePeers}
        />
      </main>

      <footer>
        {s.error && <span className="error">{s.error}</span>}
        {s.recordingInfo && <span className="hint">{s.recordingInfo}</span>}
      </footer>

      {s.finishedRecording && (
        <RecordingFinishedModal
          recording={s.finishedRecording}
          onClose={() => s.setFinishedRecording(null)}
        />
      )}
    </div>
  );
}
