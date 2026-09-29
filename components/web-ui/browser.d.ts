import type { GlSdk4Api } from './rpc-api';

export type { GlSdk4Api } from './rpc-api';

export type BrowserRpcRequest = (method: string, params: unknown[]) => Promise<unknown>;

export interface GlApiHost {
  $rpcRequest?: BrowserRpcRequest;
  $request?: BrowserRpcRequest;
  glApi?: GlSdk4Api;
}

export declare function createGlApi(
  rpc: BrowserRpcRequest
): GlSdk4Api;

export declare function resolveRpcRequest(host: GlApiHost): BrowserRpcRequest;

export declare const glApiMixin: {
  beforeCreate(this: GlApiHost): void;
};
