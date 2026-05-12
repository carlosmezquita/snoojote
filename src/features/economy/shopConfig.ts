import { config } from '../../config.js';
import { type RuntimeShopItemConfig } from '../../configLoader.js';

export type ShopItemConfig = RuntimeShopItemConfig;

export const shopCatalog: ShopItemConfig[] = config.economy.shopCatalog;
