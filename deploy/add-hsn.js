// HSN code adder script that works from deploy directory
const { execSync } = require('child_process');
const path = require('path');

console.log('=== Adding HSN Codes ===');

try {
  const backendDir = path.join(__dirname, '../backend');
  console.log(`Running from: ${backendDir}`);
  
  const script = `
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data/lyracore.db');
const db = new Database(dbPath);

try {
  // Common HSN codes for industrial products
  const hsnMappings = [
    { pattern: /button|switch|control|relay/i, hsn: '841900', description: 'Industrial Controls' },
    { pattern: /motor|pump|compressor/i, hsn: '841011', description: 'Motors & Pumps' },
    { pattern: /valve|fitting|pipe/i, hsn: '848110', description: 'Valves & Fittings' },
    { pattern: /sensor|gauge|meter|instrument/i, hsn: '903289', description: 'Instruments & Sensors' },
    { pattern: /electrical|cable|wire|panel/i, hsn: '854449', description: 'Electrical Equipment' },
    { pattern: /.*/, hsn: '841900', description: 'Industrial Machinery (Default)' }
  ];

  const products = db.prepare(\`
    SELECT id, name, model_code, product_type 
    FROM products 
    WHERE is_active = 1 
    AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
  \`).all();

  console.log(\`Found \${products.length} products without HSN codes\\n\`);

  let updated = 0;
  const updateStmt = db.prepare('UPDATE products SET hsn_sac_code = ? WHERE id = ?');

  products.forEach(product => {
    const searchText = \`\${product.name} \${product.model_code || ''} \${product.product_type || ''}\`;
    const mapping = hsnMappings.find(m => m.pattern.test(searchText));
    
    if (mapping) {
      updateStmt.run(mapping.hsn, product.id);
      updated++;
      console.log(\`✅ \${product.name} → HSN: \${mapping.hsn} (\${mapping.description})\`);
    }
  });

  console.log(\`\\n🎉 Updated \${updated} products with HSN codes!\`);
  
  const withHsn = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1 AND hsn_sac_code IS NOT NULL AND hsn_sac_code != ""').get();
  console.log(\`Total products with HSN codes now: \${withHsn.count}\`);

} catch (error) {
  console.error('Error:', error.message);
} finally {
  db.close();
}
`;

  // Write and run the script from backend directory
  const scriptPath = path.join(backendDir, 'temp-hsn-add.js');
  require('fs').writeFileSync(scriptPath, script);
  
  execSync(`cd "${backendDir}" && node temp-hsn-add.js`, { stdio: 'inherit' });
  
  // Clean up
  require('fs').unlinkSync(scriptPath);
  
  console.log('\n🎯 HSN codes added! Now refresh your quotation page to see HSN codes.');
  
} catch (error) {
  console.error('Error adding HSN codes:', error.message);
}