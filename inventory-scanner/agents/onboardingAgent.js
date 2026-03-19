const { getDb } = require('../database/db');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FALLBACK_GUIDE_STEPS = [
  {
    step_number: 1,
    step_title: 'Research & Requirements',
    step_description: 'Review the platform\'s advertiser policies, especially for fintech/BFSI category. Check SEBI compliance requirements. Gather documentation: SEBI registration certificate, company PAN, GST certificate, RBI compliance docs if applicable. Review prohibited content guidelines for financial products.',
    estimated_time: '1-2 days',
    contact_name: 'Platform Sales Team',
    contact_email: 'sales@platform.com',
    contact_phone: null,
    contact_url: null,
    minimum_commitment: 'Varies by platform',
    documents_required: 'SEBI registration, Company PAN, GST certificate, Business registration, Brand guidelines'
  },
  {
    step_number: 2,
    step_title: 'Account Setup & Verification',
    step_description: 'Create an advertiser account on the platform. Complete business verification process. Submit required documentation for fintech category approval. Set up billing with company credit card or bank transfer. Configure account-level settings: timezone (IST), currency (INR), notification preferences.',
    estimated_time: '2-5 days',
    contact_name: 'Account Manager',
    contact_email: null,
    contact_phone: null,
    contact_url: null,
    minimum_commitment: null,
    documents_required: 'Business email, Company website URL, Authorized signatory details'
  },
  {
    step_number: 3,
    step_title: 'Documentation & Compliance Review',
    step_description: 'Submit all regulatory documents for platform review. This includes SEBI advisory registration, mutual fund distributor license (if applicable), AMFI registration, and disclaimers. Prepare standard fintech disclaimers: "Investments are subject to market risks", "Past performance is not indicative of future results". Get legal team approval on ad copy templates.',
    estimated_time: '3-7 days',
    contact_name: 'Compliance Team',
    contact_email: null,
    contact_phone: null,
    contact_url: null,
    minimum_commitment: null,
    documents_required: 'SEBI advisory registration, AMFI registration, Disclaimer templates, Legal approval on ad copy'
  },
  {
    step_number: 4,
    step_title: 'Creative Preparation',
    step_description: 'Design ad creatives according to platform specifications. Prepare multiple variants for A/B testing. Ensure all creatives include mandatory disclaimers. Create assets for different placements: feed, stories, in-stream, display. Prepare landing pages with UTM parameters for tracking. Set up conversion tracking pixels/SDKs.',
    estimated_time: '3-5 days',
    contact_name: 'Creative Team',
    contact_email: null,
    contact_phone: null,
    contact_url: null,
    minimum_commitment: null,
    documents_required: 'Brand assets, Logo files, Product screenshots, Disclaimer text, Landing page URLs'
  },
  {
    step_number: 5,
    step_title: 'Campaign Setup & Configuration',
    step_description: 'Create campaign structure: Campaign > Ad Set > Ad. Configure targeting: demographics (25-45 age, Tier 1+2 cities), interests (stocks, mutual funds, personal finance, trading), behaviors (app install, finance app users). Set bid strategy (start with target CPA or lowest cost). Configure conversion tracking events (app install, registration, first trade). Set daily/lifetime budget. Schedule campaign dates.',
    estimated_time: '1-2 days',
    contact_name: 'Media Buyer',
    contact_email: null,
    contact_phone: null,
    contact_url: null,
    minimum_commitment: 'Minimum daily budget per platform requirements',
    documents_required: 'Targeting brief, Budget allocation, KPI targets, Conversion event mapping'
  },
  {
    step_number: 6,
    step_title: 'Launch & Initial Monitoring',
    step_description: 'Submit ads for review (allow 24-48h for fintech category). Once approved, launch campaign in learning phase. Monitor closely for first 72 hours: check delivery, CPM vs benchmark, click-through rates. Do not make changes during learning phase (typically 50 conversions). Set up automated rules for pacing alerts. Schedule daily performance review for first week. Plan optimization actions for post-learning phase.',
    estimated_time: '1-3 days (+ 7 days learning)',
    contact_name: 'Campaign Manager',
    contact_email: null,
    contact_phone: null,
    contact_url: null,
    minimum_commitment: null,
    documents_required: 'Launch checklist, Monitoring dashboard access, Alert configuration'
  }
];

function getOnboardingGuide(inventoryId) {
  const db = getDb();
  let steps = db.prepare(`
    SELECT * FROM onboarding_guides
    WHERE inventory_id = ?
    ORDER BY step_number ASC
  `).all(inventoryId);

  if (steps.length === 0) {
    generateGuide(inventoryId);
    steps = db.prepare(`
      SELECT * FROM onboarding_guides
      WHERE inventory_id = ?
      ORDER BY step_number ASC
    `).all(inventoryId);
  }

  const inventory = db.prepare('SELECT name, category, platform_parent FROM inventories WHERE id = ?').get(inventoryId);

  return {
    inventory_id: inventoryId,
    inventory_name: inventory ? inventory.name : 'Unknown',
    platform: inventory ? inventory.platform_parent : 'Unknown',
    category: inventory ? inventory.category : 'Unknown',
    total_steps: steps.length,
    estimated_total_time: steps.map(s => s.estimated_time).join(' + '),
    steps
  };
}

async function generateGuide(inventoryId) {
  const db = getDb();
  const inventory = db.prepare('SELECT * FROM inventories WHERE id = ?').get(inventoryId);
  if (!inventory) throw new Error(`Inventory not found: ${inventoryId}`);

  let guideSteps = [];

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an ad operations expert helping a fintech company (Univest - stock trading, mutual funds, personal finance app) onboard onto new advertising platforms in India.

Generate a detailed step-by-step activation guide for the specified ad inventory.

Return a JSON array of steps, each with:
- step_number: integer
- step_title: string
- step_description: string (detailed, 2-3 sentences minimum)
- estimated_time: string (e.g., "2-3 days")
- contact_name: string or null
- contact_email: string or null
- contact_phone: string or null
- contact_url: string or null
- minimum_commitment: string or null
- documents_required: string (comma-separated list)

Include fintech-specific requirements like SEBI registration, disclaimers, and compliance considerations.
Return ONLY the JSON array.`
        },
        {
          role: 'user',
          content: `Generate an onboarding guide for: ${inventory.name} (${inventory.category}, platform: ${inventory.platform_parent || 'Independent'}, pricing: ${inventory.pricing_model}, CPM range: ₹${inventory.min_cpm}-₹${inventory.max_cpm})`
        }
      ],
      temperature: 0.5,
      max_tokens: 3000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    guideSteps = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[OnboardingAgent] OpenAI call failed, using fallback:', err.message);
    guideSteps = FALLBACK_GUIDE_STEPS.map(step => ({
      ...step,
      step_description: step.step_description.replace(/the platform/g, inventory.name)
    }));
  }

  // Store in DB
  for (const step of guideSteps) {
    db.prepare(`
      INSERT INTO onboarding_guides (id, inventory_id, step_number, step_title, step_description,
        estimated_time, contact_name, contact_email, contact_phone, contact_url,
        minimum_commitment, documents_required, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      uuidv4(), inventoryId, step.step_number, step.step_title, step.step_description,
      step.estimated_time, step.contact_name || null, step.contact_email || null,
      step.contact_phone || null, step.contact_url || null,
      step.minimum_commitment || null, step.documents_required || null
    );
  }

  return guideSteps;
}

async function regenerateGuide(inventoryId) {
  const db = getDb();
  db.prepare('DELETE FROM onboarding_guides WHERE inventory_id = ?').run(inventoryId);
  return await generateGuide(inventoryId);
}

module.exports = { getOnboardingGuide, generateGuide, regenerateGuide };
