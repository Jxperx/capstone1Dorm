const cron = require('node-cron');
const { runMonthlySearch } = require('./marketSearchEngine');
const { autoApplyPricing } = require('./aiRentPricingEngine');

/**
 * Monthly Market Cron Job
 * Runs on the 1st of every month at 2:00 AM.
 * 1. Searches for live competitor prices via Gemini AI
 * 2. Auto-applies optimal pricing to all rooms
 * No manual trigger needed — fully automatic.
 */
const scheduleMonthlyMarketSearch = () => {
    // Cron: 0 2 1 * * → 2:00 AM on the 1st of every month
    cron.schedule('0 2 1 * *', async () => {
        const monthYear = new Date().toLocaleString('en-PH', { month: 'long', year: 'numeric' });
        console.log(`\n[Monthly Market Cron] 🚀 Starting AI Rent Optimization for ${monthYear}...`);

        try {
            // Step 1: Search & store market data
            console.log('[Monthly Market Cron] Step 1: Searching market for competitor prices...');
            const searchResult = await runMonthlySearch();
            console.log(`[Monthly Market Cron] ✅ Search done — ${searchResult.condoListings} condo + ${searchResult.dormListings} dorm listings found.`);

            // Step 2: Auto-apply optimal pricing
            console.log('[Monthly Market Cron] Step 2: Auto-applying optimal prices...');
            const applyResult = await autoApplyPricing();
            console.log(`[Monthly Market Cron] ✅ Prices auto-applied for ${applyResult.results.length} rooms.`);

            const changed = applyResult.results.filter(r => r.autoApplied);
            console.log(`[Monthly Market Cron] 📊 Summary: ${changed.length} rooms updated, ${applyResult.results.length - changed.length} rooms unchanged.`);
            console.log(`[Monthly Market Cron] 🏁 AI Rent Optimization complete for ${monthYear}.\n`);

        } catch (err) {
            console.error(`[Monthly Market Cron] ❌ Error during monthly optimization:`, err.message);
        }
    }, {
        timezone: 'Asia/Manila'
    });

    // Calculate next run date for display
    const now     = new Date();
    const nextRun = new Date(now.getFullYear(), now.getMonth() + 1, 1, 2, 0, 0);
    console.log(`[Monthly Market Cron] ✅ Scheduled. Next auto-run: ${nextRun.toLocaleString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })} at 2:00 AM`);
};

module.exports = { scheduleMonthlyMarketSearch };
