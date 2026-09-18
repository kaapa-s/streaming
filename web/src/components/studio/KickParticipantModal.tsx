import { Button } from '../Button';

type KickParticipantModalProps = {
  participantName: string;
  pending: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Irreversible moderation action: a kick disconnects the participant and writes
 * a room-scoped block, so the group cannot be rejoined with the invite link.
 */
export function KickParticipantModal({
  participantName,
  pending,
  error,
  onCancel,
  onConfirm,
}: KickParticipantModalProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kick-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface-raised p-6 shadow-lg flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 id="kick-title" className="text-lg font-semibold text-ink">
            Remove {participantName} from the room?
          </h2>
          <p className="mt-1 text-sm text-ink-muted leading-relaxed">
            They will be disconnected and cannot rejoin this room, even with the invite link.
            This cannot be undone.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={onConfirm}>
            {pending ? 'Removing…' : 'Remove from room'}
          </Button>
        </div>
      </div>
    </div>
  );
}
