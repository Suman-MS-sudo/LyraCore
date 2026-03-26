// Simple HSN check script that works from deploy directory
const { execSync } = require('child_process');
const path = require('path');

console.log('=== HSN Code Check ===');

try {
  // Run the check from backend directory where dependencies are installed
  const backendDir = path.join(__dirname, '../backend');
  console.log(`Checking from: ${backendDir}`);
  
  const script = `
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data/lyracore.db');
const db = new Database(dbPath);

try {
  const products = db.prepare(\`
    SELECT name, model_code, hsn_sac_code, is_active 
    FROM products 
    WHERE is_active = 1 
    ORDER BY name 
    LIMIT 10
  \`).all();

  console.log('\\n📋 Active Products (first 10):');
  products.forEach((p, i) => {
    console.log(\`\${i+1}. \${p.name} | Model: \${p.model_code || 'N/A'} | HSN: \${p.hsn_sac_code || 'MISSING'}\`);
  });

  const totalActive = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1').get();
  const withHsn = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1 AND hsn_sac_code IS NOT NULL AND hsn_sac_code != ""').get();

  console.log(\`\\n📊 Summary:\`);
  console.log(\`Total active products: \${totalActive.count}\`);
  console.log(\`Products with HSN codes: \${withHsn.count}\`);
  console.log(\`Products missing HSN: \${totalActive.count - withHsn.count}\`);

  if (withHsn.count === 0) {
    console.log('\\n⚠️  NO HSN CODES FOUND! This is why HSN column is empty.');
    console.log('\\n🔧 Run add-hsn.js script to add HSN codes automatically.');
  }

} catch (error) {
  console.error('Error:', error.message);
} finally {
  db.close();
}
`;

  // Write and run the script from backend directory
  const scriptPath = path.join(backendDir, 'temp-hsn-check.js');
  require('fs').writeFileSync(scriptPath, script);
  
  // Execute from backend directory where node_modules exists
  execSync(`cd "${backendDir}" && node temp-hsn-check.js`, { stdio: 'inherit' });
  
  // Clean up
  require('fs').unlinkSync(scriptPath);
  
} catch (error) {
  console.error('Error running HSN check:', error.message);
  console.log('\n🔧 Alternative: Run this from backend directory:');
  console.log('cd ../backend && node ../deploy/check-hsn-direct.js');
}