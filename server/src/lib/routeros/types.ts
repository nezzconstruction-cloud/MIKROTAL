import type { ParamValue } from './protocol.js';

export type RosRow = Record<string, string>;
export type RosParams = Record<string, ParamValue>;

export interface RouterConnection {
  readonly connected: boolean;
  connect(): Promise<void>;
  exec(command: string, params?: RosParams, queries?: string[]): Promise<RosRow[]>;
  close(): void;
  on(event: 'close', listener: () => void): this;
}

export class RouterOSError extends Error {
  constructor(
    message: string,
    public readonly category?: string,
    public readonly command?: string,
  ) {
    super(message);
    this.name = 'RouterOSError';
  }
}

export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

export interface RouterCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
  timeoutMs?: number;
}
