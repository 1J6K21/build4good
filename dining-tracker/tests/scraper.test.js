const { scrapeMenu } = require('../server/scraper');
const { LOCATIONS, PERIODS } = require('../server/constants');

async function test() {
    console.log('🚀 Starting Scraper Test...');
    
    // Test for The Commons / Lunch / Today
    const location = 'the-commons-dining-hall-south-campus';
    const period = 'lunch';
    const date = new Date().toISOString().split('T')[0];

    console.log(`Testing: ${location} | ${period} | ${date}`);
    
    try {
        const stations = await scrapeMenu(location, period, date, (step) => {
            console.log(`  [Step] ${step}`);
        });

        if (stations && stations.length > 0) {
            console.log('\n✅ SUCCESS!');
            console.log(`Retrieved ${stations.length} stations.`);
            const totalItems = stations.reduce((sum, s) => sum + s.items.length, 0);
            console.log(`Total Food Items: ${totalItems}`);
        } else {
            console.log('\n❌ FAILED: No stations returned.');
        }
    } catch (e) {
        console.error('\n💥 ERROR during test:', e.message);
    }
}

test();
