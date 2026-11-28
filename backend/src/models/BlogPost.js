const mongoose = require('mongoose');

const BLOG_CATEGORIES = ['Events', 'Travel', 'Flights', 'Guides', 'News'];

const BlogPostSchema = new mongoose.Schema({
    slug: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    excerpt: { type: String, default: '', trim: true, maxlength: 500 },
    content: { type: String, required: true, maxlength: 30000 },
    category: { type: String, enum: BLOG_CATEGORIES, default: 'Events', index: true },
    author: { type: String, default: 'Ticketsassa Editorial', trim: true, maxlength: 80 },
    coverImage: { type: String, default: '/assets/holidays/beach-holidays.jpg' },
    status: { type: String, enum: ['published', 'draft'], default: 'published', index: true },
    featured: { type: Boolean, default: false },
    readMinutes: { type: Number, default: 3 },
    publishedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

const BlogPost = mongoose.models.BlogPost || mongoose.model('BlogPost', BlogPostSchema);

module.exports = { BlogPost, BLOG_CATEGORIES };
