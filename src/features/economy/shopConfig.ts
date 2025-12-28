export interface ShopItemConfig {
    name: string;
    description: string;
    price: number;
    type: 'ROLE' | 'COLLECTIBLE';
    value: string; // Role ID or Image URL
    emoji: string;
}

export const shopCatalog: ShopItemConfig[] = [
    {
        name: 'Hidalgo',
        description: 'Un título noble de baja alcurnia.',
        price: 1000,
        type: 'ROLE',
        value: 'REPLACE_WITH_HIDALGO_ROLE_ID',
        emoji: '🗡️'
    },
    {
        name: 'Conquistador',
        description: 'Explorador y líder de expediciones.',
        price: 5000,
        type: 'ROLE',
        value: 'REPLACE_WITH_CONQUISTADOR_ROLE_ID',
        emoji: '🗺️'
    },
    {
        name: 'Capitán General',
        description: 'Comandante supremo de los ejércitos reales.',
        price: 15000,
        type: 'ROLE',
        value: 'REPLACE_WITH_CAPITAN_ROLE_ID',
        emoji: '⚔️'
    },
    {
        name: 'Gobernador',
        description: 'Administrador de una provincia.',
        price: 50000,
        type: 'ROLE',
        value: 'REPLACE_WITH_GOBERNADOR_ROLE_ID',
        emoji: '📜'
    },
    {
        name: 'Virrey',
        description: 'Representante del rey en tierras lejanas.',
        price: 100000,
        type: 'ROLE',
        value: 'REPLACE_WITH_VIRREY_ROLE_ID',
        emoji: '👑'
    },
    {
        name: 'Grande de España',
        description: 'La más alta dignidad de la nobleza.',
        price: 250000,
        type: 'ROLE',
        value: 'REPLACE_WITH_GRANDE_ROLE_ID',
        emoji: '🦁'
    }
];
