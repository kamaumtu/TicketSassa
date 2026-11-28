/* Dynamic Ticketsassa Blog powered by /api/blog */
(() => {
    const state = {
        posts: [],
        categories: ['Events', 'Travel', 'Flights', 'Guides', 'News'],
        activeCategory: 'all',
        query: '',
        loaded: false
    };

    const dateFmt = (value) => {
        if (!value) return '';
        try {
            return new Intl.DateTimeFormat('en-KE', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                timeZone: 'Africa/Nairobi'
            }).format(new Date(value));
        } catch {
            return '';
        }
    };

    function escapeHtml(v) {
        return String(v ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch] || ch));
    }

    function fastBlogImg(rawUrl, thumb = true) {
        const fallback = '/assets/real/back-to-rock-5.jpg' + (thumb ? '?thumb=1' : '');
        if (!rawUrl) return fallback;
        const str = String(rawUrl).trim();
        if (!str) return fallback;
        if (str.startsWith('data:')) return str;
        const addThumb = (path) => (!thumb || path.includes('?') || !/\.(png|jpe?g)$/i.test(path)) ? path : path + '?thumb=1';
        if (str.startsWith('/assets/') || str.startsWith('assets/')) {
            return addThumb(str.startsWith('/') ? str : '/' + str);
        }
        if (str.startsWith('/')) return str;
        try {
            const parsed = new URL(str, location.href);
            if (parsed.origin === location.origin) return addThumb(parsed.pathname) + parsed.search;
            const host = location.hostname;
            const useEdgeProxy = host && !['localhost', '127.0.0.1'].includes(host) && !host.endsWith('.onrender.com');
            if (useEdgeProxy && (parsed.protocol === 'https:' || parsed.protocol === 'http:')) {
                return '/img?url=' + encodeURIComponent(parsed.href);
            }
            return parsed.href;
        } catch {
            return fallback;
        }
    }

    function articleUrl(slug) {
        const url = new URL(location.href);
        url.search = new URLSearchParams({ view: 'blog', post: slug }).toString();
        url.hash = '';
        return url.href;
    }

    function openBlogArticle(slug) {
        const post = state.posts.find(p => p.slug === slug);
        const modal = document.getElementById('blog-reader-modal');
        if (!post || !modal) return;

        const img = document.getElementById('blog-reader-image');
        const cat = document.getElementById('blog-reader-category');
        const title = document.getElementById('blog-reader-title');
        const meta = document.getElementById('blog-reader-meta');
        const body = document.getElementById('blog-reader-content');
        const copyBtn = document.getElementById('blog-reader-copy');
        const waLink = document.getElementById('blog-reader-whatsapp');

        if (img) {
            img.src = fastBlogImg(post.coverImage, false);
            img.alt = post.title;
        }
        if (cat) cat.textContent = post.category || 'Events';
        if (title) title.textContent = post.title;
        if (meta) {
            const parts = [
                post.author || 'Ticketsassa Editorial',
                dateFmt(post.publishedAt || post.updatedAt),
                `${post.readMinutes || 3} min read`
            ].filter(Boolean);
            meta.textContent = parts.join(' · ');
        }
        if (body) {
            const paragraphs = String(post.content || '')
                .split(/\n{2,}/)
                .map(p => p.trim())
                .filter(Boolean);
            body.innerHTML = paragraphs.map(p => {
                const lines = p.split(/\n/).map(l => escapeHtml(l.trim())).filter(Boolean);
                if (lines.length === 1 && lines[0].length < 85 && !/[.!?]$/.test(lines[0])) {
                    return `<h3 class="text-base font-extrabold text-slate-900 pt-2">${lines[0]}</h3>`;
                }
                return `<p class="text-sm text-slate-700 leading-relaxed">${lines.join('<br>')}</p>`;
            }).join('');
        }

        const shareHref = articleUrl(post.slug);
        if (copyBtn) {
            copyBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(shareHref);
                    window.showToast?.('Article link copied.');
                } catch {
                    window.showToast?.('Could not copy link.');
                }
            };
        }
        if (waLink) {
            waLink.href = `https://wa.me/?text=${encodeURIComponent(`${post.title} — ${shareHref}`)}`;
        }

        modal.classList.remove('hidden');
        try {
            const nextUrl = new URL(location.href);
            nextUrl.searchParams.set('view', 'blog');
            nextUrl.searchParams.set('post', post.slug);
            if (nextUrl.href !== location.href) history.replaceState(null, '', nextUrl);
        } catch {}
    }

    function closeBlogArticle() {
        const modal = document.getElementById('blog-reader-modal');
        if (modal) modal.classList.add('hidden');
        try {
            const nextUrl = new URL(location.href);
            if (nextUrl.searchParams.has('post')) {
                nextUrl.searchParams.delete('post');
                history.replaceState(null, '', nextUrl);
            }
        } catch {}
    }

    function renderCategories() {
        const host = document.getElementById('blog-category-pills');
        if (!host) return;
        const cats = ['all', ...state.categories];
        host.innerHTML = cats.map(c => {
            const active = state.activeCategory === c;
            const label = c === 'all' ? 'All Articles' : c;
            return `<button type="button" data-blog-cat-pill="${escapeHtml(c)}" class="px-3.5 py-1.5 rounded-full text-xs font-bold border transition ${
                active
                    ? 'bg-[#D81A21] text-white border-[#D81A21]'
                    : 'bg-white text-slate-700 border-slate-300 hover:border-[#D81A21] hover:text-[#D81A21]'
            }">${escapeHtml(label)}</button>`;
        }).join('');
        host.querySelectorAll('[data-blog-cat-pill]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.activeCategory = btn.getAttribute('data-blog-cat-pill') || 'all';
                render();
            });
        });
    }

    function render() {
        renderCategories();
        renderHolidayTravelStories();
        const featuredHost = document.getElementById('blog-featured-slot');
        const gridHost = document.getElementById('blog-articles-grid');
        const statusEl = document.getElementById('blog-result-status');
        if (!gridHost) return;

        const q = state.query.trim().toLowerCase();
        const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
        const matched = state.posts.filter(post => {
            if (state.activeCategory !== 'all' && post.category !== state.activeCategory) return false;
            if (!tokens.length) return true;
            const hay = [post.title, post.excerpt, post.content, post.category, post.author].filter(Boolean).join(' ').toLowerCase();
            return tokens.every(tok => hay.includes(tok));
        });

        if (statusEl) {
            statusEl.textContent = !state.loaded
                ? 'Loading articles…'
                : matched.length
                    ? `${matched.length} ${matched.length === 1 ? 'article' : 'articles'}${state.activeCategory !== 'all' ? ' in ' + state.activeCategory : ''}${q ? ' matching "' + state.query.trim() + '"' : ''}`
                    : 'No articles match your search yet.';
        }

        if (!matched.length) {
            if (featuredHost) featuredHost.innerHTML = '';
            gridHost.innerHTML = `<div class="col-span-full bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-600">No published articles match this filter yet.</div>`;
            return;
        }

        const showFeatured = state.activeCategory === 'all' && !q && matched.length > 1;
        const featuredPost = showFeatured ? (matched.find(p => p.featured) || matched[0]) : null;
        const gridPosts = featuredPost ? matched.filter(p => p.slug !== featuredPost.slug) : matched;

        if (featuredHost) {
            if (featuredPost) {
                featuredHost.innerHTML = `
                    <article data-open-slug="${escapeHtml(featuredPost.slug)}" class="cursor-pointer bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition grid grid-cols-1 md:grid-cols-12">
                        <div class="md:col-span-5 aspect-[16/10] md:aspect-auto img-shimmer overflow-hidden bg-slate-100">
                            <img src="${escapeHtml(fastBlogImg(featuredPost.coverImage, false))}" alt="${escapeHtml(featuredPost.title)}" loading="eager" decoding="async" class="w-full h-full object-cover" onerror="this.src='/assets/real/back-to-rock-5.jpg?thumb=1'">
                        </div>
                        <div class="md:col-span-7 p-6 sm:p-8 flex flex-col justify-center gap-3">
                            <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                                <span class="px-2.5 py-0.5 rounded-full bg-rose-50 text-[#D81A21] border border-rose-200 uppercase">${escapeHtml(featuredPost.category || 'Featured')}</span>
                                <span class="text-slate-500">${escapeHtml(dateFmt(featuredPost.publishedAt || featuredPost.updatedAt))}</span>
                                <span class="text-slate-400">·</span>
                                <span class="text-slate-500">${featuredPost.readMinutes || 3} min read</span>
                            </div>
                            <h2 class="text-xl sm:text-2xl font-black text-slate-900 leading-snug">${escapeHtml(featuredPost.title)}</h2>
                            <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">${escapeHtml(featuredPost.excerpt || '')}</p>
                            <div class="pt-1 flex items-center justify-between gap-3">
                                <span class="text-xs font-semibold text-slate-500">By ${escapeHtml(featuredPost.author || 'Ticketsassa Editorial')}</span>
                                <span class="inline-flex items-center px-4 py-2 rounded-lg bg-[#D81A21] text-white text-xs font-bold">Read Article &rarr;</span>
                            </div>
                        </div>
                    </article>
                `;
                featuredHost.querySelector('[data-open-slug]')?.addEventListener('click', () => openBlogArticle(featuredPost.slug));
            } else {
                featuredHost.innerHTML = '';
            }
        }

        gridHost.innerHTML = gridPosts.map(post => `
            <article data-open-slug="${escapeHtml(post.slug)}" class="cursor-pointer bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition flex flex-col">
                <div class="aspect-[16/10] img-shimmer overflow-hidden bg-slate-100 relative">
                    <img src="${escapeHtml(fastBlogImg(post.coverImage, true))}" alt="${escapeHtml(post.title)}" loading="lazy" decoding="async" class="w-full h-full object-cover" onerror="this.src='/assets/real/back-to-rock-5.jpg?thumb=1'">
                    <span class="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-slate-900/80 text-white text-[10px] font-bold uppercase">${escapeHtml(post.category || 'Events')}</span>
                </div>
                <div class="p-5 flex flex-col gap-2 flex-1">
                    <div class="text-[11px] font-semibold text-slate-500">${escapeHtml(dateFmt(post.publishedAt || post.updatedAt))} · ${post.readMinutes || 3} min read</div>
                    <h3 class="text-base font-extrabold text-slate-900 leading-snug line-clamp-2">${escapeHtml(post.title)}</h3>
                    <p class="text-xs text-slate-600 leading-relaxed line-clamp-3">${escapeHtml(post.excerpt || '')}</p>
                    <div class="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                        <span class="text-slate-500 font-medium">${escapeHtml(post.author || 'Ticketsassa')}</span>
                        <span class="font-bold text-[#D81A21]">Read more &rarr;</span>
                    </div>
                </div>
            </article>
        `).join('');

        gridHost.querySelectorAll('[data-open-slug]').forEach(card => {
            card.addEventListener('click', () => openBlogArticle(card.getAttribute('data-open-slug')));
        });
    }

    function renderHolidayTravelStories() {
        const host = document.getElementById('holidays-travel-blog-grid');
        if (!host) return;
        const prioritized = [
            ...state.posts.filter(p => ['Travel', 'Flights', 'Guides'].includes(p.category)),
            ...state.posts.filter(p => !['Travel', 'Flights', 'Guides'].includes(p.category))
        ].slice(0, 4);

        if (!prioritized.length) {
            host.innerHTML = '<div class="col-span-full text-xs text-slate-500 py-4">No travel stories published yet.</div>';
            return;
        }

        host.innerHTML = prioritized.map(post => `
            <article data-open-holiday-slug="${escapeHtml(post.slug)}" class="group cursor-pointer space-y-2.5">
                <div class="h-40 rounded-xl overflow-hidden border border-slate-200 img-shimmer bg-slate-100">
                    <img loading="lazy" decoding="async" src="${escapeHtml(fastBlogImg(post.coverImage, true))}" alt="${escapeHtml(post.title)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.src='/assets/holidays/voyager-beach-resort.jpg?thumb=1'">
                </div>
                <span class="block text-[11px] text-slate-500">${escapeHtml(dateFmt(post.publishedAt || post.updatedAt))} &bull; ${escapeHtml(post.category || 'Travel')}</span>
                <h4 class="font-bold text-slate-900 text-sm group-hover:text-emerald-700 transition leading-snug line-clamp-2">${escapeHtml(post.title)}</h4>
                <p class="text-xs text-slate-500 line-clamp-2">${escapeHtml(post.excerpt || '')}</p>
            </article>
        `).join('');

        host.querySelectorAll('[data-open-holiday-slug]').forEach(card => {
            card.addEventListener('click', () => {
                const slug = card.getAttribute('data-open-holiday-slug');
                if (typeof window.switchTab === 'function') window.switchTab('blog');
                openBlogArticle(slug);
            });
        });
    }

    let lastLoadedAt = 0;

    async function loadBlog(forceFresh = false) {
        const params = new URLSearchParams(location.search);
        const wantFresh = forceFresh || params.get('fresh') === '1' || Boolean(params.get('post'));
        try {
            const res = await fetch('/api/blog' + (wantFresh ? '?fresh=1' : ''));
            if (res.ok) {
                const json = await res.json();
                state.posts = Array.isArray(json.data) ? json.data : [];
                if (Array.isArray(json.categories) && json.categories.length) {
                    state.categories = json.categories;
                }
                lastLoadedAt = Date.now();
            }
        } catch {}
        state.loaded = true;
        render();

        const linkedSlug = params.get('post');
        if (linkedSlug && state.posts.some(p => p.slug === linkedSlug)) {
            openBlogArticle(linkedSlug);
        }
    }

    window.filterBlog = (value) => {
        state.query = String(value || '');
        render();
    };
    window.filterBlogCategory = (category) => {
        state.activeCategory = category || 'all';
        render();
    };
    window.openBlogArticle = openBlogArticle;
    window.closeBlogArticle = closeBlogArticle;
    window.refreshTicketsasaBlog = () => void loadBlog(true);
    window.ensureTicketsasaBlogLoaded = () => {
        if (!state.loaded || Date.now() - lastLoadedAt > 20_000) {
            void loadBlog(state.loaded);
        }
    };

    function init() {
        const searchInput = document.getElementById('blog-search');
        if (searchInput) {
            searchInput.addEventListener('input', e => {
                state.query = e.target.value || '';
                render();
            });
        }
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeBlogArticle();
        });
        void loadBlog(false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
