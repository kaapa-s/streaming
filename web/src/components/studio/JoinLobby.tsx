import { Button } from '../Button';

type JoinLobbyProps = {
  userName: string;
  room: string;
  joining: boolean;
  logoutPending: boolean;
  error: string;
  onJoin: () => void;
  onLogout: () => void;
};

export function JoinLobby({
  userName,
  room,
  joining,
  logoutPending,
  error,
  onJoin,
  onLogout,
}: JoinLobbyProps) {
  return (
    <div className="lobby">
      <h1>Streaming Studio</h1>
      <p className="hint">
        Signed in as <strong>{userName}</strong> · Room: <strong>{room}</strong>
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          onJoin();
        }}
      >
        <Button type="submit" loading={joining}>
          {joining ? 'Joining…' : 'Join studio'}
        </Button>
        <Button type="button" variant="danger" loading={logoutPending} onClick={onLogout}>
          {logoutPending ? 'Logging out…' : 'Log out'}
        </Button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
