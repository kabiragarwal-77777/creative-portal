let OpenAI;
try { OpenAI = require('openai').OpenAI; } catch (e) { /* openai not installed */ }

async function generateCreativeConcepts(trend, format, productionContext) {
  if (!OpenAI) throw new Error('OpenAI SDK not installed. Run: npm install openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Default production context values
  const ctx = {
    script_style: productionContext?.script_style || 'ugc',
    talent_direction: productionContext?.talent_direction || 'male_25_35',
    shooting_setup: productionContext?.shooting_setup || 'home',
    hinglish: productionContext?.hinglish ?? false,
  };

  const videoRules = `
VIDEO AD RULES:
- Duration options: 6s (bumper) / 15s (non-skip) / 30s (skippable) — specify which
- First 3 seconds are EVERYTHING — must hook before skip button appears
- Subtitles mandatory (80% watch on mute)
- On-screen text must reinforce audio, not repeat it
- Pacing: cuts every 2-3 seconds keeps attention
- End card: always 3-5 seconds with app download CTA
- Music: upbeat but not chaotic — financial confidence vibe

PRODUCTION CONTEXT:
- Script Style: ${ctx.script_style} ${ctx.script_style === 'ugc' ? '(authentic, phone-shot feel, creator-led)' : ctx.script_style === 'talking_head' ? '(single presenter, direct to camera, confident delivery)' : ctx.script_style === 'screen_recording' ? '(app walkthrough, cursor/finger movements, real data on screen)' : ctx.script_style === 'motion_graphic' ? '(animated text, charts, icons — no live talent needed)' : ctx.script_style === 'meme' ? '(meme-format, trending audio, relatable humor, fast cuts)' : ''}
- Talent: ${ctx.talent_direction} ${ctx.talent_direction === 'male_25_35' ? '(young Indian male, relatable, casual but knowledgeable)' : ctx.talent_direction === 'female_25_35' ? '(young Indian female, confident, modern professional vibe)' : ctx.talent_direction === 'no_talent' ? '(voiceover only, screen/animation focus)' : ''}
- Shooting Setup: ${ctx.shooting_setup} ${ctx.shooting_setup === 'home' ? '(bedroom/living room, natural light, phone on tripod, authentic feel)' : ctx.shooting_setup === 'office' ? '(clean desk setup, ring light, professional but not corporate)' : ctx.shooting_setup === 'outdoor' ? '(street/cafe/park, ambient sound, handheld feel)' : ctx.shooting_setup === 'stock' ? '(use stock footage + text overlays + voiceover)' : ''}
- Language: ${ctx.hinglish ? 'Hinglish (Hindi-English mix — e.g. "Bhai, market crash ho gaya but Univest users ko pehle se pata tha")' : 'English only (clear, simple, no jargon)'}`;

  const staticRules = `
STATIC AD RULES:
- Thumb-stop element: something visually unexpected or data-led in the image
- Text hierarchy: Headline (large) > Subheadline (medium) > Body (small) > CTA (button)
- Headline: MAX 6 words. Must be able to read in 1 second.
- Always include: a number, a specific claim, or a chart element
- Color usage: purple/teal on dark background performs best for Univest
- Size: specify aspect ratio (1:1 for feed, 9:16 for story/reel, 4:5 for feed optimal)

VISUAL DIRECTION:
- Background type: dark gradient (#08080d to #1a1a2e) with subtle grid/noise texture for premium feel, OR bold solid color block for high-contrast thumb-stop
- Mood: confident and data-rich — the ad should feel like an insider tip, not a generic finance poster
- Layout style: asymmetric with clear focal point — avoid centered-everything designs. Use rule of thirds.
- Hero element: always ONE dominant visual (chart, number, phone mockup) — never crowd with multiple equal elements

TYPOGRAPHY SUGGESTIONS:
- Headline: Bold weight, sans-serif (Inter Bold, Poppins Bold, or Satoshi Black). Size ≥ 48pt equivalent at 1080px width.
- Subheadline: Medium weight, same family. 60-70% of headline size.
- Body/data: Regular weight. Use tabular/monospace numerals for financial figures (₹ amounts, percentages).
- CTA button text: Bold, ALL CAPS, 14-18pt, high contrast against button background.
- Letter-spacing: slightly tight (-0.02em) for headlines, normal for body.
- Line-height: 1.1 for headlines, 1.4 for body text.

COLOR USAGE:
- Primary purple #6c5ce7 for CTA buttons, key highlights, and brand elements
- Teal #00d4aa for positive numbers, growth indicators, and success states
- Red #ff6b6b for negative numbers, urgency elements, and loss indicators (use sparingly)
- White #ffffff for primary text on dark backgrounds
- Gray #888888 for secondary text, disclaimers, fine print
- Never use more than 3 accent colors in a single ad — keep it focused
- Ensure WCAG AA contrast ratio (4.5:1 minimum) for all text

PRINT-READY SPECIFICATIONS:
- Design at 1080x1080 (1:1), 1080x1350 (4:5), or 1080x1920 (9:16)
- Safe zone: keep critical text 60px from all edges
- Export: PNG at 2x resolution for retina, JPEG at 80% quality for file size optimization
- Max file size: 5MB for Meta, 150KB for Google Display
- Include bleed area marks if outputting for any print collateral`;

  const systemPrompt = format === 'video'
    ? `You are a performance marketing creative director who has written scripts for India's top fintech brands.

UNIVEST BRAND:
- Product: Stock advisory subscriptions + Demat/Trading accounts
- Tone: Confident, data-backed, trustworthy. NOT misleading. NOT fake returns.
- Brand colors: Primary purple #6c5ce7, Teal #00d4aa, Dark bg #08080d, White text
- CTA style: "Start Free Trial" / "Open Free Demat" / "Get Expert Advice" / "Download App"
- SEBI registered — can mention this for trust
- Target: Indian retail investors, 25-45, Android

PERFORMANCE AD PRINCIPLES:
- Hook must create an immediate emotional response in first 3 seconds
- Must be relevant to what the person just read/searched (trend-jacked)
- Promise must be specific and believable — no "guaranteed returns"
- Must drive app installs > subscription conversion
- D6 ROAS target: >28%. Best performing format historically: problem-solution with specific number

${videoRules}`
    : `You are Univest's Creative Director generating performance ad concepts.

UNIVEST BRAND:
- Product: Stock advisory subscriptions + Demat/Trading accounts
- Tone: Confident, data-backed, trustworthy. NOT misleading. NOT fake returns.
- Brand colors: Primary purple #6c5ce7, Teal #00d4aa, Dark bg #08080d, White text
- CTA style: "Start Free Trial" / "Open Free Demat" / "Get Expert Advice" / "Download App"
- SEBI registered — can mention this for trust
- Target: Indian retail investors, 25-45, Android

PERFORMANCE AD PRINCIPLES:
- Hook must create an immediate emotional response in first 3 seconds
- Must be relevant to what the person just read/searched (trend-jacked)
- Promise must be specific and believable — no "guaranteed returns"
- Must drive app installs > subscription conversion
- D6 ROAS target: >28%. Best performing format historically: problem-solution with specific number

${staticRules}`;

  const videoSchema = `"duration": 30,
      "format_type": "one of: talking_head, screen_recording, animation, ugc_style, news_ticker, chart_animation, meme",
      "hook_first_3_seconds": {
        "visual": "SPECIFIC visual description — e.g. 'Close-up of phone showing Nifty -3.2% with red candles, hand trembling'",
        "audio": "EXACT spoken words or sound effect — e.g. 'Nifty crashed 3% today. Did you lose money?'",
        "text_overlay": "EXACT text shown on screen during hook",
        "why_it_works": "Psychology behind this hook — e.g. 'Loss aversion triggers immediate attention in investors who check portfolio daily'",
        "emotion_trigger": "The gut reaction this creates — e.g. 'Instant panic about portfolio losses'"
      },
      "full_script": [
        { "section": "HOOK", "timestamp": "0:00-0:03", "visual": "SPECIFIC scene: camera angle, talent action, background detail", "audio": "EXACT voiceover words", "text_overlay": "EXACT bold text on screen", "why_it_works": "Scroll-stop psychology reason" },
        { "section": "PROBLEM_BUILD", "timestamp": "0:03-0:10", "visual": "SPECIFIC scene description with talent emotion/action", "audio": "EXACT voiceover words building tension", "text_overlay": "EXACT text reinforcing the problem", "b_roll_suggestion": "Specific B-roll clip to intercut — e.g. 'Stock ticker scrolling red, news headline montage'" },
        { "section": "SOLUTION_REVEAL", "timestamp": "0:10-0:22", "visual": "SPECIFIC scene: product demo, app screen, talent reaction", "audio": "EXACT voiceover revealing Univest as solution", "text_overlay": "EXACT text — feature highlight or data point", "screen_recording_notes": "If showing app: exact screens, taps, data to display" },
        { "section": "SOCIAL_PROOF", "timestamp": "0:22-0:27", "visual": "SPECIFIC proof element visual", "audio": "EXACT voiceover with proof statement", "proof_element": "Specific proof — e.g. '14,000+ subscribers', 'SEBI registered RIA', '42% avg D6 ROAS for users'" },
        { "section": "CTA", "timestamp": "0:27-0:30", "visual": "SPECIFIC CTA scene — app download screen, QR code, end card", "audio": "EXACT CTA voiceover words", "text_overlay": "EXACT CTA text on screen", "cta_button_text": "EXACT button text — e.g. 'Download Free → Start 7-Day Trial'" }
      ],
      "production_notes": {
        "editing_pace": "Specific pace — e.g. 'Fast cuts every 2s during problem build, slow down for solution reveal'",
        "music_vibe": "SPECIFIC: genre, energy, BPM — e.g. 'Cinematic tension, builds to hopeful, 100-120 BPM, strings + electronic'",
        "caption_style": "Caption format — e.g. 'Bold white with yellow highlight on keywords, bottom-center, 2 words max per line'",
        "shooting_location": "Exact setup — e.g. 'Bedroom desk, ring light from left, phone on tripod, clutter visible for authenticity'",
        "props_needed": "List of props — e.g. 'Phone with Univest app open, laptop showing red charts, coffee mug'",
        "compliance_check": "Any regulatory flags — e.g. 'Add disclaimer: Investments are subject to market risks'"
      },
      "performance_prediction": {
        "hook_strength": "1-10 score with reasoning",
        "expected_d0_cvr": "Expected Day-0 conversion rate range — e.g. '1.2-2.1%'",
        "best_audience": "Target audience segment — e.g. 'Males 25-35, recently searched stock market crash, Android, Tier 1 cities'",
        "test_against": "What to A/B test — e.g. 'Test same script with female talent vs male talent'"
      },
      "subtitles": true,
      "aspect_ratio": "9:16",
      "thumbnail_frame": "Which timestamp + why it stops the scroll — e.g. '0:02 — the red -3.2% number creates urgency'"`;

  const staticSchema = `"aspect_ratio": "one of: 1:1, 4:5, 9:16",
      "headline": "EXACT headline text, MAX 6 words, punchy — e.g. 'Nifty Down 3%. Now What?'",
      "subheadline": "EXACT subheadline, 1 line — e.g. 'Our subscribers got an exit alert 2 days before the crash'",
      "body_copy": "EXACT body text, 2-3 lines — e.g. 'SEBI-registered advisory. 14,000+ subscribers trust Univest for market crashes.'",
      "cta_text": "EXACT button text — e.g. 'Start Free Trial →'",
      "visual_concept": {
        "background": "SPECIFIC description — e.g. 'Dark gradient #08080d to #1a1a2e, subtle grid pattern overlay with 0.05 opacity noise texture'",
        "background_type": "one of: dark_gradient, bold_solid, split_tone, glassmorphism, minimal_white",
        "mood": "one of: urgent, confident, educational, aspirational, insider — with 1-line description of the feeling",
        "layout_style": "one of: asymmetric_hero, centered_stack, split_layout, card_overlay, data_dashboard — with positioning details",
        "main_visual_element": "SPECIFIC element — e.g. 'Nifty candlestick chart showing 3 red candles, with a green arrow turning up at the end (Univest intervention)'",
        "color_palette": ["#6c5ce7", "#00d4aa", "#ffffff"],
        "color_usage_notes": "How each color is used — e.g. 'Purple for CTA button and accent line, Teal for positive % number, White for headline text'",
        "typography_style": "one of: bold, clean, editorial — plus specific font suggestion and weight",
        "typography_details": {
          "headline_font": "Font suggestion — e.g. 'Inter Bold, -0.02em tracking, 54pt at 1080px width'",
          "subheadline_font": "Font suggestion — e.g. 'Inter Medium, normal tracking, 28pt'",
          "body_font": "Font suggestion — e.g. 'Inter Regular, tabular numerals for ₹ figures, 18pt'",
          "cta_font": "Font suggestion — e.g. 'Inter Bold, ALL CAPS, 16pt, #ffffff on #6c5ce7 button'"
        },
        "data_element": "SPECIFIC number/chart — e.g. '₹0 Brokerage' badge or 'D6 ROAS 42%' chart"
      },
      "text_overlay_hierarchy": [
        { "text": "EXACT headline text", "size": "large", "color": "#ffffff", "position": "top or center", "font_weight": "bold", "max_width": "80% of canvas" },
        { "text": "EXACT subheadline text", "size": "medium", "color": "#00d4aa", "position": "center", "font_weight": "medium" },
        { "text": "EXACT body or data text", "size": "small", "color": "#888888", "position": "bottom", "font_weight": "regular" },
        { "text": "EXACT CTA button text", "size": "button", "color": "#ffffff", "position": "bottom-center", "font_weight": "bold", "button_bg": "#6c5ce7" }
      ],
      "print_specs": {
        "canvas_size": "1080x1080 or 1080x1350 or 1080x1920",
        "safe_zone": "60px from all edges for critical text",
        "export_format": "PNG 2x for retina, JPEG 80% for file size",
        "max_file_size": "5MB Meta, 150KB Google Display"
      }`;

  const hookIdeas = trend.hook_ideas ? `\nHOOK IDEAS FROM TREND ANALYSIS:\n${trend.hook_ideas.map((h, i) => `${i+1}. ${h}`).join('\n')}` : '';

  const productionContextBlock = format === 'video' ? `
PRODUCTION CONTEXT:
- Style: ${ctx.script_style}
- Talent: ${ctx.talent_direction}
- Shooting Setup: ${ctx.shooting_setup}
- Language: ${ctx.hinglish ? 'Hinglish (Hindi-English mix)' : 'English only'}
` : '';

  const videoInstructions = format === 'video' ? `
WRITE A COMPLETE, PRODUCTION-READY SCRIPT with these sections:
- HOOK (0-3s): Visual, Audio/VO (exact words), Text overlay, WHY IT WORKS
- PROBLEM BUILD (3-10s): Visual, Audio/VO, Text overlay, B-roll suggestion
- SOLUTION REVEAL (10-22s): Visual, Audio/VO, Text overlay, Screen recording notes
- SOCIAL PROOF (22-27s): Visual, Audio/VO, Proof element
- CTA (27-30s): Visual, Audio/VO, Text overlay, CTA button text

Include PRODUCTION NOTES: Editing pace, Music vibe, Caption style, Shooting location, Props needed, Compliance check
Include PERFORMANCE PREDICTION: Hook strength, Expected D0 CVR, Best audience, Test against
` : '';

  const userPrompt = `Generate 3 ${format} ad concepts for this trending topic:

TREND CONTEXT:
Topic: ${trend.topic}
Description: ${trend.description}
Univest Angle: ${trend.univest_angle}
Audience Emotion: ${trend.audience_emotion}
Signal Strength: ${trend.signal_strength}
Urgency: ${trend.urgency}
Market Mood: ${trend.market_mood || 'neutral'}${hookIdeas}
${productionContextBlock}${videoInstructions}
CRITICAL INSTRUCTIONS:
- Every text field must contain REAL, SPECIFIC, FINAL copy — not descriptions or placeholders.
- Headlines must be punchy, use numbers or questions, and be immediately understandable.
- Video scripts: every "audio" field must contain the EXACT words the voiceover artist will say. Every "visual" must describe EXACTLY what the viewer sees — camera angle, colors, screen content.${ctx.hinglish && format === 'video' ? '\n- ALL dialogue and voiceover MUST be in Hinglish (Hindi-English mix). Use natural Hindi slang mixed with English financial terms. Example: "Bhai, market 3% crash ho gaya but Univest users ko 2 din pehle alert mil gaya tha."' : ''}
- Static ads: "headline" is the EXACT text that will be set in large font. "subheadline" is the EXACT supporting line. "body_copy" is EXACT small print.
- Each of the 3 concepts MUST use a genuinely different emotional angle: one fear/urgency-based, one aspiration/greed-based, one education/trust-based.
- Be specific to the Indian market — use ₹ symbol, mention Nifty/Sensex, reference Indian investor psychology.

Return this exact JSON:
{
  "trend_id": "${trend.trend_id}",
  "format": "${format}",
  "generated_at": "ISO datetime",
  "production_context": ${JSON.stringify(ctx)},
  "concepts": [
    {
      "concept_id": "C001",
      "angle": "fear|aspiration|education|social_proof|offer|urgency",
      "hook_score": 8,
      "predicted_ctr_range": "2.1-3.4%",
      ${format === 'video' ? videoSchema : staticSchema},
      "compliance_check": {
        "makes_return_guarantee": false,
        "mentions_sebi": true,
        "risk_disclaimer_needed": false,
        "flags": []
      },
      "a_b_test_suggestion": "specific variation to test — e.g. 'Replace ₹ number with % number in headline'"
    }
  ]
}

Return valid JSON only. All 3 concepts must have completely different angles and copy.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 6000,
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

async function generateAllConcepts(trends) {
  const results = { static: [], video: [] };
  // Generate for top 8 trends (balances coverage vs API cost)
  const topN = (trends.top_trends || []).slice(0, 8);

  for (const trend of topN) {
    const enrichedTrend = { ...trend, market_mood: trends.market_mood };
    try {
      const [staticConcepts, videoConcepts] = await Promise.all([
        generateCreativeConcepts(enrichedTrend, 'static'),
        generateCreativeConcepts(enrichedTrend, 'video'),
      ]);
      results.static.push(staticConcepts);
      results.video.push(videoConcepts);
    } catch (e) {
      console.warn(`Script generation failed for ${trend.trend_id}:`, e.message);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return results;
}

module.exports = { generateAllConcepts, generateCreativeConcepts };
