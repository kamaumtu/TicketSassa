import React, { useEffect, useState } from 'react';

type BlogPostItem = {
    _id: string;
    slug: string;
    title: string;
    excerpt: string;
    content: string;
    category: string;
    author: string;
    coverImage: string;
    status: 'published' | 'draft';
    featured: boolean;
    readMinutes?: number;
    publishedAt?: string | null;
    updatedAt?: string;
};

const DEFAULT_CATEGORIES = ['Events', 'Travel', 'Flights', 'Guides', 'News'];
const PRESET_COVERS = [
    { label: 'Concert Stage', url: '/assets/real/back-to-rock-5.jpg' },
    { label: 'Nightlife / Party', url: '/assets/real/back-and-forth-party.jpg' },
    { label: 'Diani Beach', url: '/assets/holidays/dest-diani.jpg' },
    { label: 'Mombasa Coast', url: '/assets/holidays/dest-mombasa.jpg' },
    { label: 'Maasai Mara Safari', url: '/assets/holidays/dest-mara.jpg' },
    { label: 'Naivasha Getaway', url: '/assets/holidays/dest-naivasha.jpg' }
];

const dateFmt = (value?: string | null) =>
    value ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(new Date(value)) : '—';

async function blogRequest<T>(path = '', method = 'GET', body?: object): Promise<T> {
    const res = await fetch('/api/admin/blog' + path, {
        method,
        credentials: 'same-origin',
        headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json', 'X-Admin-Action': 'dashboard' },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `Blog request failed (${res.status})`);
    return data as T;
}

async function compressCoverPhoto(file: File): Promise<string> {
    const bitmapUrl = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const node = new Image();
            node.onload = () => resolve(node);
            node.onerror = () => reject(new Error('Could not decode image file.'));
            node.src = bitmapUrl;
        });
        const maxDim = 1200;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
            const scale = Math.min(maxDim / width, maxDim / height);
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Image compression unavailable.');
        ctx.drawImage(img, 0, 0, width, height);
        let mime = 'image/webp';
        let out = canvas.toDataURL(mime, 0.8);
        if (!out.startsWith('data:image/webp')) {
            mime = 'image/jpeg';
            out = canvas.toDataURL(mime, 0.8);
        }
        for (const q of [0.7, 0.58, 0.45]) {
            if (out.length <= 500000) break;
            out = canvas.toDataURL(mime, q);
        }
        return out;
    } finally {
        URL.revokeObjectURL(bitmapUrl);
    }
}

export function BlogManagerPanel({ storefrontUrl = 'https://ticketsassa.ticketsassa.workers.dev' }: { storefrontUrl?: string }) {
    const [posts, setPosts] = useState<BlogPostItem[]>([]);
    const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
    const [storageAvailable, setStorageAvailable] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all');
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    const [form, setForm] = useState({
        title: '',
        category: 'Events',
        author: 'Ticketsassa Editorial',
        excerpt: '',
        content: '',
        coverImage: '/assets/real/back-to-rock-5.jpg',
        status: 'published' as 'published' | 'draft',
        featured: false
    });

    async function load() {
        const res = await blogRequest<{ data: BlogPostItem[]; categories?: string[]; storageAvailable?: boolean }>('');
        setPosts(res.data || []);
        if (res.categories?.length) setCategories(res.categories);
        setStorageAvailable(res.storageAvailable !== false);
    }

    useEffect(() => {
        void load().catch(err => setMsg(err instanceof Error ? err.message : 'Failed to load blog posts.'));
    }, []);

    function resetForm() {
        setEditingId(null);
        setForm({
            title: '',
            category: 'Events',
            author: 'Ticketsassa Editorial',
            excerpt: '',
            content: '',
            coverImage: '/assets/real/back-to-rock-5.jpg',
            status: 'published',
            featured: false
        });
    }

    function startEdit(post: BlogPostItem) {
        setEditingId(post._id);
        setForm({
            title: post.title,
            category: post.category || 'Events',
            author: post.author || 'Ticketsassa Editorial',
            excerpt: post.excerpt || '',
            content: post.content || '',
            coverImage: post.coverImage || '/assets/real/back-to-rock-5.jpg',
            status: post.status === 'draft' ? 'draft' : 'published',
            featured: Boolean(post.featured)
        });
        setMsg(`Editing "${post.title}"`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function handleCoverUpload(file?: File) {
        if (!file) return;
        setBusy(true);
        setMsg('Compressing cover image to WebP…');
        try {
            const dataUrl = await compressCoverPhoto(file);
            setForm(f => ({ ...f, coverImage: dataUrl }));
            setMsg(`Cover image ready (${Math.round((dataUrl.length * 3) / 4 / 1024)} KB).`);
        } catch (err) {
            setMsg(err instanceof Error ? err.message : 'Could not optimize cover image.');
        } finally {
            setBusy(false);
        }
    }

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        if (busy || !storageAvailable) return;
        setBusy(true);
        setMsg('');
        try {
            if (editingId) {
                await blogRequest('/' + encodeURIComponent(editingId), 'PUT', form);
                setMsg('Article updated and live on the storefront blog.');
            } else {
                await blogRequest('', 'POST', form);
                setMsg(form.status === 'published' ? 'Article published to the storefront blog.' : 'Draft article saved.');
            }
            resetForm();
            await load();
        } catch (err) {
            setMsg(err instanceof Error ? err.message : 'Could not save article.');
        } finally {
            setBusy(false);
        }
    }

    async function toggleStatus(post: BlogPostItem) {
        setBusy(true);
        setMsg('');
        try {
            const nextStatus = post.status === 'published' ? 'draft' : 'published';
            await blogRequest('/' + encodeURIComponent(post._id), 'PUT', { status: nextStatus });
            setMsg(nextStatus === 'published' ? `"${post.title}" published.` : `"${post.title}" moved to drafts.`);
            await load();
        } catch (err) {
            setMsg(err instanceof Error ? err.message : 'Status update failed.');
        } finally {
            setBusy(false);
        }
    }

    async function deletePost(post: BlogPostItem) {
        setBusy(true);
        setMsg('');
        try {
            await blogRequest('/' + encodeURIComponent(post._id), 'DELETE');
            if (editingId === post._id) resetForm();
            setMsg(`Deleted "${post.title}".`);
            await load();
        } catch (err) {
            setMsg(err instanceof Error ? err.message : 'Delete failed.');
        } finally {
            setBusy(false);
        }
    }

    const cleanOrigin = storefrontUrl.replace(/\/+$/, '');
    const filtered = posts.filter(p => {
        if (filter !== 'all' && p.status !== filter) return false;
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return [p.title, p.category, p.excerpt, p.author].join(' ').toLowerCase().includes(q);
    });

    return <div className="publishing-lobby">
        {msg && <p className="notice" role="status">{msg}</p>}
        {!storageAvailable && <p className="notice">Database offline — connect MongoDB before publishing or editing blog posts.</p>}

        <section className="panel">
            <div className="lobby-toolbar">
                <div>
                    <h2>{editingId ? 'Edit Blog Article' : 'Write New Blog Article'}</h2>
                    <p>Published articles appear immediately on the storefront Blog tab with search, category filters, and WhatsApp sharing.</p>
                </div>
                <div className="actions">
                    <a href={`${cleanOrigin}/?view=blog&fresh=1`} target="_blank" rel="noreferrer">Open Public Blog</a>
                    {editingId && <button type="button" onClick={resetForm}>New Article</button>}
                </div>
            </div>

            <form onSubmit={handleSave} style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                <div className="form-grid">
                    <label>
                        Article Title
                        <input required maxLength={180} placeholder="e.g. Top Concerts in Nairobi This December" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                    </label>
                    <label>
                        Category
                        <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </label>
                    <label>
                        Author
                        <input maxLength={80} placeholder="Ticketsassa Editorial" value={form.author} onChange={e => setForm({ ...form, author: e.target.value })} />
                    </label>
                    <label>
                        Visibility
                        <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as 'published' | 'draft' })}>
                            <option value="published">Published (Live)</option>
                            <option value="draft">Draft (Hidden)</option>
                        </select>
                    </label>
                </div>

                <div className="form-grid">
                    <label>
                        Cover Image URL or Preset
                        <input placeholder="/assets/real/back-to-rock-5.jpg or https://..." value={form.coverImage} onChange={e => setForm({ ...form, coverImage: e.target.value })} />
                    </label>
                    <label>
                        Quick Cover Preset
                        <select value={PRESET_COVERS.some(p => p.url === form.coverImage) ? form.coverImage : ''} onChange={e => { if (e.target.value) setForm({ ...form, coverImage: e.target.value }); }}>
                            <option value="">Choose preset photo…</option>
                            {PRESET_COVERS.map(p => <option key={p.url} value={p.url}>{p.label}</option>)}
                        </select>
                    </label>
                    <label>
                        Upload Cover Photo (Auto-WebP)
                        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => void handleCoverUpload(e.target.files?.[0])} />
                    </label>
                    <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22 }}>
                        <input type="checkbox" checked={form.featured} onChange={e => setForm({ ...form, featured: e.target.checked })} style={{ minHeight: 'auto' }} />
                        <span>Pin as Featured Story</span>
                    </label>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', fontWeight: 600 }}>
                    Short Summary / Excerpt (optional — auto-generated from content if blank)
                    <input maxLength={500} placeholder="1–2 sentence preview shown on the blog card…" value={form.excerpt} onChange={e => setForm({ ...form, excerpt: e.target.value })} />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', fontWeight: 600 }}>
                    Article Content (separate paragraphs with a blank line)
                    <textarea
                        required
                        rows={8}
                        placeholder="Write your full article here..."
                        value={form.content}
                        onChange={e => setForm({ ...form, content: e.target.value })}
                        style={{ font: 'inherit', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical' }}
                    />
                </label>

                <div className="actions">
                    <button className="primary" type="submit" disabled={busy || !storageAvailable}>
                        {busy ? 'Saving…' : editingId ? 'Update Article' : form.status === 'published' ? 'Publish Article' : 'Save Draft'}
                    </button>
                    {editingId && <button type="button" onClick={resetForm}>Cancel Edit</button>}
                </div>
            </form>
        </section>

        <section className="panel">
            <div className="lobby-toolbar">
                <h3>Blog Articles ({filtered.length})</h3>
                <div className="actions">
                    <input placeholder="Search articles…" value={search} onChange={e => setSearch(e.target.value)} />
                    <select value={filter} onChange={e => setFilter(e.target.value as any)}>
                        <option value="all">All Statuses</option>
                        <option value="published">Published</option>
                        <option value="draft">Drafts</option>
                    </select>
                    <button type="button" onClick={() => void load()}>Refresh</button>
                </div>
            </div>
            <div className="scroll">
                <table>
                    <thead>
                        <tr><th>Article</th><th>Category</th><th>Status</th><th>Updated</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                        {filtered.map(post => (
                            <tr key={post._id || post.slug}>
                                <td>
                                    {post.coverImage && <img src={post.coverImage} alt="" loading="lazy" decoding="async" />}
                                    <strong>{post.title}</strong>
                                    {post.featured && <small style={{ marginLeft: 6, color: '#a4163e', fontWeight: 700 }}>★ Featured</small>}
                                    <small style={{ display: 'block', opacity: 0.72 }}>{post.author} · {post.readMinutes || 3} min read</small>
                                </td>
                                <td>{post.category}</td>
                                <td><span className="payment-badge" data-status={post.status === 'published' ? 'COMPLETED' : 'PENDING'}>{post.status === 'published' ? 'Published' : 'Draft'}</span></td>
                                <td>{dateFmt(post.updatedAt || post.publishedAt)}</td>
                                <td className="actions">
                                    <button type="button" disabled={busy} onClick={() => startEdit(post)}>Edit</button>
                                    <button type="button" disabled={busy} onClick={() => void toggleStatus(post)}>{post.status === 'published' ? 'Unpublish' : 'Publish'}</button>
                                    {post.status === 'published' && (
                                        <a href={`${cleanOrigin}/?view=blog&post=${encodeURIComponent(post.slug)}&fresh=1`} target="_blank" rel="noreferrer">View</a>
                                    )}
                                    <button type="button" disabled={busy} onClick={() => void deletePost(post)}>Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!filtered.length && <p style={{ opacity: 0.75 }}>No blog articles match this filter yet.</p>}
            </div>
        </section>
    </div>;
}
