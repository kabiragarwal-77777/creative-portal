const {
    fetchAndMatchMetaMetabase,
    createEndpointFetchers,
    createDirectFetchers,
} = require('./meta-metabase-contract');

async function exampleUsingExistingPortalEndpoints() {
    const result = await fetchAndMatchMetaMetabase({
        dateFrom: '2026-03-25',
        dateTo: '2026-04-02',
        fetchers: createEndpointFetchers({
            baseUrl: 'http://localhost:3000',
        }),
        testCampaigns: [
            'Test4-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_200326',
            'Test-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_131125',
            'Test2-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_051225',
        ],
    });

    console.log('Matched ads:', result.ads.length);
    console.log('Diagnostics:', result.diagnostics);
}

async function exampleUsingDirectMetaAndMetabaseCredentials() {
    const result = await fetchAndMatchMetaMetabase({
        dateFrom: '2026-03-25',
        dateTo: '2026-04-02',
        fetchers: createDirectFetchers({
            metaApiBase: 'https://graph.facebook.com/v21.0',
            metaAdAccountId: 'act_725019929189148',
            metaAccessToken: process.env.META_ACCESS_TOKEN,
            metaAppSecretProof: process.env.META_APP_SECRET_PROOF,
            metabaseUrl: 'https://analytics.univest.in',
            metabaseSessionToken: process.env.METABASE_SESSION_TOKEN,
        }),
        testCampaigns: [
            'Test4-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_200326',
            'Test-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_131125',
            'Test2-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_051225',
        ],
    });

    console.log('Matched ads:', result.ads.length);
    console.log('Diagnostics:', result.diagnostics);
}

module.exports = {
    exampleUsingExistingPortalEndpoints,
    exampleUsingDirectMetaAndMetabaseCredentials,
};
