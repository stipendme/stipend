export declare const SIZE: number;
export declare const BADGE: number;
export declare const badgeSvg: string;
export declare function fetchIcon(asset: { symbol: string; mint: string; logo?: string }): Promise<Buffer>;
export declare function composeMark(raw: Buffer): Promise<{ png: Buffer; svg: string; assetPng: Buffer }>;
export declare function fallbackMark(symbol: string): Promise<{ png: Buffer; svg: string }>;
