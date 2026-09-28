import type { ClientMessage, PlayerView, ServerMessage } from '@bs/shared';

export interface NetHandlers {
  view(view: PlayerView): void;
  cursor(cell: number | null): void;
  error(message: string, fatal: boolean): void;
  connection(connected: boolean): void;
}

/** WebSocket link to the game server; reconnects on its own, and the server resends the view. */
export class Net {
  private socket: WebSocket | null = null;
  private retryMs = 500;
  private stopped = false;

  constructor(
    private readonly token: string,
    private readonly handlers: NetHandlers,
  ) {
    this.connect();
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  private connect(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${proto}//${location.host}/ws?token=${encodeURIComponent(this.token)}`,
    );
    this.socket = socket;
    socket.onopen = () => {
      this.retryMs = 500;
      this.handlers.connection(true);
    };
    socket.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      if (msg.t === 'view') this.handlers.view(msg.view);
      else if (msg.t === 'cursor') this.handlers.cursor(msg.cell);
      else {
        if (msg.fatal) this.stopped = true;
        this.handlers.error(msg.message, msg.fatal ?? false);
      }
    };
    socket.onclose = () => {
      this.handlers.connection(false);
      if (this.stopped) return;
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5000);
    };
  }
}
