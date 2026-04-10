# Matching Contract

## Source shape

### Meta daily rows

Expected grain:

- one row per `date_start × campaign × adset × ad`

Required fields:

- `date_start`
- `campaign_name`
- `campaign_id`
- `adset_name`
- `adset_id`
- `ad_name`
- `ad_id`
- `spend`
- `impressions`
- `clicks`
- `installs`
- `thruplay`
- `p25`
- `p100`

### Metabase funnel rows

Expected grain:

- one row per `signup_date × tracker campaign × tracker adset × tracker creative`

Required fields:

- `date`
- `campaign_name`
- `ad_set_name`
- `tracker_name`
- `meta_campaign_id`
- `signups`
- `p0_signup`
- `p1_signup`
- `total_trial`
- `d0_trial`
- `d0`
- `d0_revenue`
- `d6`
- `d6_revenue`
- `overall_revenue`
- `d6_overall_con`
- `d6_overall_revenue`
- `d15_overall_con`
- `d15_overall_revenue`
- `d30_overall_con`
- `d30_overall_revenue`
- `d60_overall_con`
- `d60_overall_revenue`
- `d180_overall_con`
- `d180_overall_revenue`

## Canonical join key

The exact join key is:

`date.substring(0,10) + "|||" + normalizeCampaignName(campaign_name) + "|||" + normalizeAdsetName(adset_name) + "|||" + normalizeTrackerName(tracker_name_or_ad_name)`

### Normalizers

#### `normalizeCampaignName`

- lowercase
- trim
- collapse internal whitespace to one space

#### `normalizeAdsetName`

- lowercase
- trim
- collapse internal whitespace to one space

#### `normalizeTrackerName`

- strip suffix after `:`
- lowercase
- trim
- collapse internal whitespace to one space

This means:

- Metabase `tracker_name`
- Meta `ad_name`

must both be normalized through the same tracker normalizer before matching.

## Raw-first rule

Always:

1. build leaf raw records
2. sum raw records into the requested entity or date bucket
3. derive KPIs from the summed raw record

Never:

- average CPI/CTR/ROAS rows directly
- sum ROAS percentages
- sum signup cost values
- compute KPI first and then aggregate

## Mismatch interpretation

Low daily-row match rate alone is not enough to call the data broken.

Reason:

- Meta spend is spend-date keyed
- Metabase funnel is signup-date keyed

So the safe interpretation is:

- spend-only rows are valid spend rows
- matched rows are used for funnel-economics benchmarks
- daily-row match rate is a debug signal, not a blanket optimization blocker

## Retargeting caveat

This portal treats unmatched retargeting rows specially.

Do not automatically classify unmatched retargeting rows as broken prospecting.

## Ad level

The native contract here is strongest at:

- ad leaf records
- then roll up to adset / campaign

If the target project uses campaign/adset-level surfaces only, keep the leaf-level join anyway, then aggregate up.
