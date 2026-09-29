export declare const ADMIN_SESSION_PATTERN: RegExp;

export interface SDK4AdminRuntime {
  $getCookie(name: 'Admin-Token'): string | null | undefined;
}

export declare function getAdminSessionId(browser?: SDK4AdminRuntime): string;
export declare function createAdminSessionHeaders(
  browser?: SDK4AdminRuntime,
  headers?: Record<string, string>
): Record<string, string>;
