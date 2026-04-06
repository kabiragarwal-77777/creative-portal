// =============================================================================
// Feedback Engine — Knowledge Crawler Agent
// Expands portal knowledge base by discovering new signal sources
// =============================================================================

const crypto = require('crypto');
const { callAI, callAIJson } = require('./feAI');
const { getFeDb, insert, update, getOne, getAll, count, query, run, logSchedulerStart, logSchedulerEnd } = require('../db/fe-db');

const DEFAULT_SOURCES = [
    {
        source_name: 'MoneyControl Technicals',
        source_url: 'https://www.moneycontrol.com/rss/technicals.xml',
        source_type: 'rss',
        crawl_frequency_hours: 6
    },
    {
        source_name: 'ET Markets',
        source_url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
        source_type: 'rss',
        crawl_frequency_hours: 6
    }
];

module.exports = function (config) {

    // ── Seed default sources if fe_knowledge_sources is empty ──
    function seedDefaultSources() {
        try {
            const existing = count('fe_knowledge_sources');
            if (existing === 0) {
                console.log('[FE:KnowledgeCrawler] Seeding default knowledge sources...');
                for (const src of DEFAULT_SOURCES) {
                    insert('fe_knowledge_sources', src);
                }
                console.log(`[FE:KnowledgeCrawler] Seeded ${DEFAULT_SOURCES.length} default sources`);
            }
        } catch (err) {
            console.error('[FE:KnowledgeCrawler] Error seeding sources:', err.message);
        }
    }

    // Run on load
    seedDefaultSources();

    // ── Content hash for dedup ──
    function contentHash(url) {
        return crypto.createHash('md5').update(url).digest('hex');
    }

    // ── Parse JSON from Claude response ──
    function parseJsonResponse(text) {
        let cleaned = text.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
        else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
        if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
        cleaned = cleaned.trim();
        return JSON.parse(cleaned);
    }

    // ── Extract signal via AI API ──
    async function extractSignal(content, sourceName) {
        try {
            const result = await callAIJson(
                `Given this content from ${sourceName}: ${content}\nExtract: signal_type, relevance_to_univest (0-10), key_insight (1 sentence), action_implication, urgency (high|medium|low)\nReturn only valid JSON.`,
                { maxTokens: 512, fallback: null }
            );
            if (result) return result;
            return {
                signal_type: 'unknown',
                relevance_to_univest: 0,
                key_insight: content.substring(0, 200),
                action_implication: 'Review manually',
                urgency: 'low'
            };
        } catch (err) {
            console.error('[FE:KnowledgeCrawler] AI extraction failed:', err.message);
            return {
                signal_type: 'unknown',
                relevance_to_univest: 0,
                key_insight: content.substring(0, 200),
                action_implication: 'Review manually',
                urgency: 'low'
            };
        }
    }

    // ── 1. Crawl RSS feed ──
    async function crawlRSS(sourceUrl, sourceName) {
        console.log(`[FE:KnowledgeCrawler] Crawling RSS: ${sourceName} (${sourceUrl})`);
        let processed = 0;
        let skipped = 0;

        try {
            const Parser = require('rss-parser');
            const parser = new Parser({ timeout: 15000 });
            const feed = await parser.parseURL(sourceUrl);

            if (!feed || !feed.items || feed.items.length === 0) {
                console.log(`[FE:KnowledgeCrawler] No items in feed: ${sourceName}`);
                return { processed: 0, skipped: 0 };
            }

            for (const item of feed.items) {
                try {
                    const url = item.link || item.guid || '';
                    if (!url) { skipped++; continue; }

                    const hash = contentHash(url);

                    // Dedup check
                    const existing = query(
                        `SELECT id FROM fe_knowledge_items WHERE content_hash = ?`,
                        [hash]
                    );
                    if (existing.length > 0) { skipped++; continue; }

                    const rawContent = [item.title || '', item.contentSnippet || item.content || '']
                        .filter(Boolean)
                        .join(' — ')
                        .substring(0, 2000);

                    // Extract signal via Claude
                    const signal = await extractSignal(rawContent, sourceName);

                    insert('fe_knowledge_items', {
                        source_type: 'rss',
                        source_url: sourceUrl,
                        source_name: sourceName,
                        content_hash: hash,
                        raw_content_preview: rawContent.substring(0, 500),
                        signal_type: signal.signal_type || 'unknown',
                        relevance_score: signal.relevance_to_univest || 0,
                        key_insight: signal.key_insight || rawContent.substring(0, 200),
                        action_implication: signal.action_implication || null,
                        urgency: ['high', 'medium', 'low'].includes(signal.urgency) ? signal.urgency : 'low',
                        is_processed: 1
                    });
                    processed++;
                } catch (err) {
                    console.error(`[FE:KnowledgeCrawler] Error processing RSS item:`, err.message);
                    skipped++;
                }
            }

            // Update source last crawl time
            const sourceRows = query(
                `SELECT id FROM fe_knowledge_sources WHERE source_url = ?`,
                [sourceUrl]
            );
            if (sourceRows.length > 0) {
                update('fe_knowledge_sources', sourceRows[0].id, {
                    last_crawled_at: new Date().toISOString(),
                    last_item_count: processed
                });
            }
        } catch (err) {
            console.error(`[FE:KnowledgeCrawler] RSS crawl failed for ${sourceName}:`, err.message);
        }

        console.log(`[FE:KnowledgeCrawler] ${sourceName}: ${processed} new, ${skipped} skipped`);
        return { processed, skipped };
    }

    // ── 2. Crawl Tier 1: Ad libraries (existing data) ──
    async function crawlTier1() {
        console.log('[FE:KnowledgeCrawler] Crawling Tier 1 (Ad Library data)...');
        let processed = 0;

        // Scan existing Meta ad library data from competitor module
        try {
            const path = require('path');
            const createDb = require('../lib/duckdb-adapter').createDb;

            // Try competitor/meta ad data
            const ciDbPath = path.resolve(__dirname, '../../creative-intelligence/ci.db');
            let ciDb = null;
            try {
                ciDb = await createDb(ciDbPath);
                const recentAds = await ciDb.prepare(
                    `SELECT * FROM ci_competitor_ads WHERE created_at > CURRENT_TIMESTAMP - INTERVAL 7 DAY ORDER BY created_at DESC LIMIT 50`
                ).all();

                for (const ad of recentAds) {
                    const url = ad.url || ad.ad_id || `ci-competitor-${ad.id}`;
                    const hash = contentHash(url);

                    const existing = query(`SELECT id FROM fe_knowledge_items WHERE content_hash = ?`, [hash]);
                    if (existing.length > 0) continue;

                    const rawContent = [ad.advertiser_name, ad.ad_text, ad.page_name]
                        .filter(Boolean)
                        .join(' — ')
                        .substring(0, 2000);

                    if (!rawContent) continue;

                    const signal = await extractSignal(rawContent, 'Meta Ad Library');

                    insert('fe_knowledge_items', {
                        source_type: 'ad_library',
                        source_url: url,
                        source_name: 'Meta Ad Library',
                        content_hash: hash,
                        raw_content_preview: rawContent.substring(0, 500),
                        signal_type: signal.signal_type || 'competitor_creative',
                        relevance_score: signal.relevance_to_univest || 5,
                        key_insight: signal.key_insight || rawContent.substring(0, 200),
                        action_implication: signal.action_implication || null,
                        urgency: ['high', 'medium', 'low'].includes(signal.urgency) ? signal.urgency : 'medium',
                        is_processed: 1
                    });
                    processed++;
                }
            } catch (err) {
                console.log('[FE:KnowledgeCrawler] Tier1 CI db scan skipped:', err.message);
            }

            // Try Google Ads transparency data
            const gcDbPath = path.resolve(__dirname, '../../google-creative/google-creative.db');
            try {
                const gcDb = await createDb(gcDbPath);
                const recentAds = await gcDb.prepare(
                    `SELECT * FROM gc_competitor_ads WHERE created_at > CURRENT_TIMESTAMP - INTERVAL 7 DAY ORDER BY created_at DESC LIMIT 50`
                ).all();

                for (const ad of recentAds) {
                    const url = ad.url || ad.ad_id || `gc-competitor-${ad.id}`;
                    const hash = contentHash(url);

                    const existing = query(`SELECT id FROM fe_knowledge_items WHERE content_hash = ?`, [hash]);
                    if (existing.length > 0) continue;

                    const rawContent = [ad.advertiser_name, ad.headline, ad.description]
                        .filter(Boolean)
                        .join(' — ')
                        .substring(0, 2000);

                    if (!rawContent) continue;

                    const signal = await extractSignal(rawContent, 'Google Ads Transparency');

                    insert('fe_knowledge_items', {
                        source_type: 'ad_library',
                        source_url: url,
                        source_name: 'Google Ads Transparency',
                        content_hash: hash,
                        raw_content_preview: rawContent.substring(0, 500),
                        signal_type: signal.signal_type || 'competitor_creative',
                        relevance_score: signal.relevance_to_univest || 5,
                        key_insight: signal.key_insight || rawContent.substring(0, 200),
                        action_implication: signal.action_implication || null,
                        urgency: ['high', 'medium', 'low'].includes(signal.urgency) ? signal.urgency : 'medium',
                        is_processed: 1
                    });
                    processed++;
                }
            } catch (err) {
                console.log('[FE:KnowledgeCrawler] Tier1 GC db scan skipped:', err.message);
            }
        } catch (err) {
            console.error('[FE:KnowledgeCrawler] Tier 1 crawl error:', err.message);
        }

        console.log(`[FE:KnowledgeCrawler] Tier 1: ${processed} new items`);
        return { processed };
    }

    // ── 3. Crawl Tier 2: Financial RSS feeds ──
    async function crawlTier2() {
        console.log('[FE:KnowledgeCrawler] Crawling Tier 2 (Financial RSS)...');
        let totalProcessed = 0;

        const tier2Sources = query(
            `SELECT * FROM fe_knowledge_sources WHERE source_type = 'rss' AND is_active = 1`
        );

        // If no sources configured, use defaults
        const sources = tier2Sources.length > 0 ? tier2Sources : DEFAULT_SOURCES;

        for (const src of sources) {
            const result = await crawlRSS(
                src.source_url,
                src.source_name
            );
            totalProcessed += result.processed;
        }

        // Also crawl NSE circulars as a special source
        try {
            const hash = contentHash(`nse-circulars-${new Date().toISOString().split('T')[0]}`);
            const existing = query(`SELECT id FROM fe_knowledge_items WHERE content_hash = ?`, [hash]);
            if (existing.length === 0) {
                const axios = require('axios');
                const resp = await axios.get('https://www.nseindia.com/api/circulars', {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    timeout: 10000
                }).catch(() => null);

                if (resp && resp.data && Array.isArray(resp.data)) {
                    const recent = resp.data.slice(0, 5);
                    for (const circ of recent) {
                        const circHash = contentHash(circ.link || circ.subject || `nse-${circ.id}`);
                        const circExisting = query(`SELECT id FROM fe_knowledge_items WHERE content_hash = ?`, [circHash]);
                        if (circExisting.length > 0) continue;

                        const rawContent = `NSE Circular: ${circ.subject || circ.title || 'Unknown'}`;
                        const signal = await extractSignal(rawContent, 'NSE Circulars');

                        insert('fe_knowledge_items', {
                            source_type: 'regulatory',
                            source_url: circ.link || 'https://www.nseindia.com/regulations/circulars',
                            source_name: 'NSE Circulars',
                            content_hash: circHash,
                            raw_content_preview: rawContent.substring(0, 500),
                            signal_type: signal.signal_type || 'regulatory',
                            relevance_score: signal.relevance_to_univest || 3,
                            key_insight: signal.key_insight || rawContent.substring(0, 200),
                            action_implication: signal.action_implication || null,
                            urgency: ['high', 'medium', 'low'].includes(signal.urgency) ? signal.urgency : 'low',
                            is_processed: 1
                        });
                        totalProcessed++;
                    }
                }
            }
        } catch (err) {
            console.log('[FE:KnowledgeCrawler] NSE circulars crawl skipped:', err.message);
        }

        console.log(`[FE:KnowledgeCrawler] Tier 2: ${totalProcessed} new items`);
        return { processed: totalProcessed };
    }

    // ── 4. Crawl Tier 3: Social / app reviews ──
    async function crawlTier3() {
        console.log('[FE:KnowledgeCrawler] Crawling Tier 3 (Social/Reviews)...');
        let processed = 0;

        // App reviews — scan from any cached review data
        try {
            const fs = require('fs');
            const path = require('path');

            // Check for app review cache files
            const reviewPaths = [
                path.resolve(__dirname, '../../app-reviews-cache.json'),
                path.resolve(__dirname, '../../data/app-reviews.json')
            ];

            for (const reviewPath of reviewPaths) {
                if (!fs.existsSync(reviewPath)) continue;

                try {
                    const reviews = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
                    const reviewList = Array.isArray(reviews) ? reviews : (reviews.reviews || []);

                    for (const review of reviewList.slice(0, 20)) {
                        const url = review.url || review.id || `review-${review.date || Date.now()}`;
                        const hash = contentHash(url);

                        const existing = query(`SELECT id FROM fe_knowledge_items WHERE content_hash = ?`, [hash]);
                        if (existing.length > 0) continue;

                        const rawContent = `App Review (${review.rating || '?'} stars): ${review.text || review.content || ''}`.substring(0, 2000);
                        if (rawContent.length < 30) continue;

                        const signal = await extractSignal(rawContent, 'App Reviews');

                        insert('fe_knowledge_items', {
                            source_type: 'app_review',
                            source_url: url,
                            source_name: 'App Reviews',
                            content_hash: hash,
                            raw_content_preview: rawContent.substring(0, 500),
                            signal_type: signal.signal_type || 'user_sentiment',
                            relevance_score: signal.relevance_to_univest || 5,
                            key_insight: signal.key_insight || rawContent.substring(0, 200),
                            action_implication: signal.action_implication || null,
                            urgency: ['high', 'medium', 'low'].includes(signal.urgency) ? signal.urgency : 'low',
                            is_processed: 1
                        });
                        processed++;
                    }
                } catch (parseErr) {
                    console.log(`[FE:KnowledgeCrawler] Could not parse ${reviewPath}:`, parseErr.message);
                }
            }

            // LinkedIn / Twitter mentions — scan from cached social data
            const socialPaths = [
                path.resolve(__dirname, '../../social-mentions-cache.json'),
                path.resolve(__dirname, '../../data/social-mentions.json')
            ];

            for (const socialPath of socialPaths) {
                if (!fs.existsSync(socialPath)) continue;

                try {
                    const mentions = JSON.parse(fs.readFileSync(socialPath, 'utf8'));
                    const mentionList = Array.isArray(mentions) ? mentions : (mentions.mentions || []);

                    for (const mention of mentionList.slice(0, 20)) {
                        const url = mention.url || mention.id || `social-${mention.date || Date.now()}`;
                        const hash = contentHash(url);

                        const existing = query(`SELECT id FROM fe_knowledge_items WHERE content_hash = ?`, [hash]);
                        if (existing.length > 0) continue;

                        const rawContent = `${mention.platform || 'Social'}: ${mention.text || mention.content || ''}`.substring(0, 2000);
                        if (rawContent.length < 20) continue;

                        const signal = await extractSignal(rawContent, mention.platform || 'Social Media');

                        insert('fe_knowledge_items', {
                            source_type: 'social',
                            source_url: url,
                            source_name: mention.platform || 'Social Media',
                            content_hash: hash,
                            raw_content_preview: rawContent.substring(0, 500),
                            signal_type: signal.signal_type || 'social_mention',
                            relevance_score: signal.relevance_to_univest || 3,
                            key_insight: signal.key_insight || rawContent.substring(0, 200),
                            action_implication: signal.action_implication || null,
                            urgency: ['high', 'medium', 'low'].includes(signal.urgency) ? signal.urgency : 'low',
                            is_processed: 1
                        });
                        processed++;
                    }
                } catch (parseErr) {
                    console.log(`[FE:KnowledgeCrawler] Could not parse ${socialPath}:`, parseErr.message);
                }
            }
        } catch (err) {
            console.error('[FE:KnowledgeCrawler] Tier 3 crawl error:', err.message);
        }

        console.log(`[FE:KnowledgeCrawler] Tier 3: ${processed} new items`);
        return { processed };
    }

    // ── 5. Crawl All ──
    async function crawlAll(tier) {
        const logId = logSchedulerStart('feKnowledgeCrawler.crawlAll');
        let totalProcessed = 0;
        let errors = [];

        try {
            if (!tier || tier === 1) {
                const r = await crawlTier1();
                totalProcessed += r.processed;
            }
            if (!tier || tier === 2) {
                const r = await crawlTier2();
                totalProcessed += r.processed;
            }
            if (!tier || tier === 3) {
                const r = await crawlTier3();
                totalProcessed += r.processed;
            }

            // Always check taxonomy expansion after crawling
            await checkTaxonomyExpansion();

            logSchedulerEnd(logId, totalProcessed, errors.length > 0 ? errors.join('; ') : null);
        } catch (err) {
            console.error('[FE:KnowledgeCrawler] crawlAll error:', err.message);
            errors.push(err.message);
            logSchedulerEnd(logId, totalProcessed, errors.join('; '));
        }

        console.log(`[FE:KnowledgeCrawler] Total crawled: ${totalProcessed} new items`);
        return { totalProcessed, errors };
    }

    // ── 6. Get Items ──
    async function getItems(filters = {}) {
        try {
            let sql = 'SELECT * FROM fe_knowledge_items WHERE 1=1';
            const params = [];

            if (filters.source) {
                sql += ' AND source_name = ?';
                params.push(filters.source);
            }
            if (filters.urgency) {
                sql += ' AND urgency = ?';
                params.push(filters.urgency);
            }
            if (filters.days) {
                sql += ` AND ingested_at > CURRENT_TIMESTAMP - INTERVAL ${parseInt(filters.days)} DAY`;
            }
            if (filters.signal_type) {
                sql += ' AND signal_type = ?';
                params.push(filters.signal_type);
            }

            sql += ' ORDER BY ingested_at DESC LIMIT ?';
            params.push(filters.limit || 200);

            return query(sql, params);
        } catch (err) {
            console.error('[FE:KnowledgeCrawler] getItems error:', err.message);
            return [];
        }
    }

    // ── 7. Get Sources ──
    async function getSources() {
        try {
            return getAll('fe_knowledge_sources', {}, 'source_name ASC', 100);
        } catch (err) {
            console.error('[FE:KnowledgeCrawler] getSources error:', err.message);
            return [];
        }
    }

    // ── 8. Add Source ──
    async function addSource(sourceData) {
        try {
            if (!sourceData.source_name || !sourceData.source_url) {
                throw new Error('source_name and source_url are required');
            }

            // Check for duplicate URL
            const existing = query(
                `SELECT id FROM fe_knowledge_sources WHERE source_url = ?`,
                [sourceData.source_url]
            );
            if (existing.length > 0) {
                console.log(`[FE:KnowledgeCrawler] Source already exists: ${sourceData.source_url}`);
                return { id: existing[0].id, duplicate: true };
            }

            const id = insert('fe_knowledge_sources', {
                source_name: sourceData.source_name,
                source_url: sourceData.source_url,
                source_type: sourceData.source_type || 'rss',
                crawl_frequency_hours: sourceData.crawl_frequency_hours || 6,
                is_active: 1
            });

            console.log(`[FE:KnowledgeCrawler] Added source: ${sourceData.source_name} (id=${id})`);
            return { id, duplicate: false };
        } catch (err) {
            console.error('[FE:KnowledgeCrawler] addSource error:', err.message);
            throw err;
        }
    }

    // ── 9. Check Taxonomy Expansion ──
    async function checkTaxonomyExpansion() {
        try {
            // Count unclassified items (signal_type = 'unknown')
            const unclassified = query(
                `SELECT COUNT(*) as cnt FROM fe_knowledge_items WHERE signal_type = 'unknown' OR signal_type IS NULL`
            );
            const unclassifiedCount = unclassified[0] ? unclassified[0].cnt : 0;

            if (unclassifiedCount < 3) {
                console.log(`[FE:KnowledgeCrawler] ${unclassifiedCount} unclassified items, threshold not met (need 3+)`);
                return { proposed: false, unclassified: unclassifiedCount };
            }

            // Check if we already have a pending TAXONOMY_EXPANSION proposal
            const existingProposal = query(
                `SELECT id FROM fe_proposals WHERE proposal_type = 'TAXONOMY_EXPANSION' AND status = 'pending'`
            );
            if (existingProposal.length > 0) {
                console.log('[FE:KnowledgeCrawler] Pending TAXONOMY_EXPANSION proposal already exists');
                return { proposed: false, existing_proposal_id: existingProposal[0].id };
            }

            // Fetch unclassified items for analysis
            const items = query(
                `SELECT id, raw_content_preview, source_name FROM fe_knowledge_items WHERE signal_type = 'unknown' OR signal_type IS NULL LIMIT 20`
            );

            // Generate taxonomy proposal via AI
            let proposedTaxonomy = await callAIJson(
                `You are analyzing unclassified knowledge items for Univest (Indian fintech). Here are ${items.length} items that don't fit existing signal types:\n\n${items.map(i => `- [${i.source_name}] ${i.raw_content_preview}`).join('\n')}\n\nExisting signal types: regulatory, competitor_creative, market_trend, user_sentiment, social_mention, unknown.\n\nPropose 1-3 new signal_type categories that would classify these items. For each:\n- signal_type name (snake_case)\n- description\n- example items from above that fit\n\nReturn valid JSON: { proposed_types: [{ name, description, matching_item_count }] }`,
                { maxTokens: 1024, fallback: { proposed_types: [{ name: 'uncategorized_signal', description: 'Items requiring manual classification', matching_item_count: unclassifiedCount }] } }
            );

            // Create proposal
            const proposalId = insert('fe_proposals', {
                proposal_type: 'TAXONOMY_EXPANSION',
                title: `Expand signal taxonomy: ${unclassifiedCount} unclassified items detected`,
                description: `${unclassifiedCount} knowledge items could not be classified under existing signal types. Proposing ${(proposedTaxonomy.proposed_types || []).length} new categories.`,
                rationale: `Unclassified items reduce the effectiveness of knowledge-driven insights. Expanding taxonomy improves signal routing.`,
                evidence_json: JSON.stringify({
                    unclassified_count: unclassifiedCount,
                    sample_items: items.slice(0, 5).map(i => ({ source: i.source_name, preview: i.raw_content_preview })),
                    proposed_taxonomy: proposedTaxonomy
                }),
                expected_impact_metric: 'knowledge_classification_rate',
                expected_impact_delta: (unclassifiedCount / Math.max(count('fe_knowledge_items'), 1)) * 100,
                risk_level: 'low',
                is_reversible: 1,
                generated_by_agent: 'feKnowledgeCrawler',
                generated_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            });

            console.log(`[FE:KnowledgeCrawler] Created TAXONOMY_EXPANSION proposal id=${proposalId}`);
            return { proposed: true, proposal_id: proposalId, unclassified: unclassifiedCount };
        } catch (err) {
            console.error('[FE:KnowledgeCrawler] checkTaxonomyExpansion error:', err.message);
            return { proposed: false, error: err.message };
        }
    }

    return {
        crawlRSS,
        crawlTier1,
        crawlTier2,
        crawlTier3,
        crawlAll,
        getItems,
        getSources,
        addSource,
        checkTaxonomyExpansion
    };
};
