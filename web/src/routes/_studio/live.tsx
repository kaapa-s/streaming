import { createFileRoute } from '@tanstack/react-router';
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
        resolution={s.resolution}
        onResolutionChange={s.setResolution}
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
      />

      <main>
        <section className="preview-section">
          <h2>Program preview</h2>
          <div className="preview" ref={s.previewRef} />
        </section>

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
