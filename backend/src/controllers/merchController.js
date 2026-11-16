const { getPromo } = require('../services/promos');
const MerchProduct = require('../models/MerchProduct');
const { isConnected } = require('../config/db');
const { availability, demoEnabled } = require('../services/commerceDb');

const defaultMerch = [
    {
        productKey: 'konshens-tour-hoodie',
        title: 'Konshens "The Hype" Nairobi Heavyweight Hoodie',
        category: 'Official Concert Merch',
        priceKes: 3500,
        priceUsd: 28,
        image: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=600&q=80',
        sizes: ['S', 'M', 'L', 'XL', '2XL'],
        stock: 120,
        creator: 'Konshens Official Storefront'
    },
    {
        productKey: 'time-attack-team-tee',
        title: 'DMSC Time Attack "The Last Lap" Trackside Tee',
        category: 'Motorsport Apparel',
        priceKes: 2000,
        priceUsd: 16,
        image: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=80',
        sizes: ['S', 'M', 'L', 'XL'],
        stock: 250,
        creator: 'Delta Motor Sport Club'
    },
    {
        productKey: 'talanta-speed-snapback',
        title: 'Talanta Sports City × HustleSasa Aero Cap',
        category: 'Headwear',
        priceKes: 1500,
        priceUsd: 12,
        image: 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=600&q=80',
        sizes: ['One Size Fits All'],
        stock: 300,
        creator: 'Talanta Sports City Store'
    },
    {
        productKey: 'dmsc-drift-lanyard',
        title: 'VIP Pit Lane Paddock Lanyard & Souvenir Pin',
        category: 'Accessories',
        priceKes: 800,
        priceUsd: 6.5,
        image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
        sizes: ['Standard'],
        stock: 500,
        creator: 'DMSC Official'
    }
];

async function getMerchCatalog() {
    const products = isConnected() ? await MerchProduct.find().lean() : defaultMerch;
    return (products.length ? products : defaultMerch).map(item => ({ ...item, published: true }));
}

exports.getMerchCatalog = getMerchCatalog;

exports.getAllMerch = async (req, res, next) => {
    try {
        const data = await Promise.all((await getMerchCatalog()).map(async item => ({
            ...item,
            stock: await availability('merch:' + item.productKey, item.stock)
        })));
        res.json({ success: true, count: data.length, data });
    } catch (error) {
        next(error);
    }
};

exports.validatePromo = (req, res) => {
    if (!demoEnabled()) {
        return res.status(400).json({ success: false, message: 'Promo codes are currently unavailable.' });
    }
    const promo = getPromo(req.body.code);
    if (!promo) return res.status(400).json({ success: false, valid: false, message: 'Invalid promo code.' });
    res.json({ success: true, valid: true, ...promo });
};
