import { NETWORK_URLS } from '../services/hl/network.ts';

export const API_BASE = NETWORK_URLS.api;
export const WS_URL = NETWORK_URLS.ws;

export const DEFAULT_LEVERAGE = 10;
export const DEFAULT_INITIAL_BALANCE = '10000';

export const MAKER_FEE_RATE = '0.00015';  // 0.015% = 1.5bp (HL Tier 0 base)
export const TAKER_FEE_RATE = '0.00045';  // 0.045% = 4.5bp (HL Tier 0 base)

export const MAINTENANCE_MARGIN_RATE = '0.05'; // 5%
