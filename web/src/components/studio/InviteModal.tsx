import { useCallback, useEffect, useState } from 'react';
import {
  createRoomInvite,
  listRoomInvites,
  revokeRoomInvite,
  type RoomInviteSummary,
} from '../../lib/auth';
import { Button } from '../Button';

type InviteModalProps = {
  slug: string;
  onClose: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

export function InviteModal({ slug, onClose }: InviteModalProps) {
  const [invites, setInvites] = useState<RoomInviteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setInvites(await listRoomInvites(slug));
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = invites.find((invite) => invite.revokedAt === null) ?? null;
  const linkUrl = active?.url ?? null;

  const rotate = async () => {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      // Regenerate = revoke the active link, then mint a fresh one.
      if (active) await revokeRoomInvite(slug, active.id);
      await createRoomInvite(slug);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!active) return;
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      await revokeRoomInvite(slug, active.id);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      setError('');
    } catch {
      setError('Could not access the clipboard. Copy the link manually.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-surface-raised p-6 shadow-lg flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="invite-title" className="text-lg font-semibold text-ink">
              Invite
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Share this link. People who open it join off-scene; you put them on the program.
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-ink-muted">Loading invite link…</p>
        ) : linkUrl ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-stretch gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
                type="text"
                readOnly
                value={linkUrl}
                aria-label="Invite link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button variant="primary" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            {copied && <span className="text-sm text-success">Copied to clipboard</span>}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-sm font-medium text-ink">
              {active ? 'This link needs to be regenerated' : 'No invite link yet'}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {active
                ? 'This invite was created before full links were stored. Regenerate it to get a shareable URL.'
                : 'Create one link to share with everyone you want in this stream.'}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-subtle">
            Regenerating invalidates the previous link.
          </p>
          <div className="flex gap-2">
            <Button disabled={busy} loading={busy} onClick={() => void rotate()}>
              {linkUrl ? 'Regenerate link' : 'Create link'}
            </Button>
            {active && (
              <Button variant="danger" disabled={busy} onClick={() => void disable()}>
                Disable link
              </Button>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
