declare module "@fails-components/webtransport" {
  export class Http3Server {
    constructor(opts: {
      port: number;
      host: string;
      secret: string;
      cert: Buffer | Uint8Array;
      privKey: Buffer | Uint8Array;
    });
    startServer(): void;
    stopServer?: () => void;
    sessionStream(path: string): Promise<ReadableStream<WebTransportSessionLike>>;
  }

  export interface WebTransportSessionLike {
    incomingBidirectionalStreams: ReadableStream<{
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<Uint8Array>;
    }>;
  }
}
