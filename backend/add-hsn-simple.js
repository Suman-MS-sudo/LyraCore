// Simple HSN adder - run this from backend directory: node add-hsn-simple.js
// This script requires better-sqlite3 to be installed in the backend

const path = require('path');

console.log('=== Simple HSN Code Addition ===');

try {
  // Try to load better-sqlite3 from current directory (backend)
  const Database = require('better-sqlite3');
  
  // Connect to database
  const dbPath = path.join(__dirname, 'data/lyracore.db');
  console.log(`Connecting to: ${dbPath}`);
  
  const db = new Database(dbPath);

  // Check current state
  const products = db.prepare(`
    SELECT id, name, model_code, product_type, hsn_sac_code
    FROM products 
    WHERE is_active = 1 
    AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
    ORDER BY name
  `).all();

  console.log(`\nFound ${products.length} products without HSN codes:`);
  
  if (products.length === 0) {
    console.log('✅ All active products already have HSN codes!');
    process.exit(0);
  }

  // Show products that need HSN codes
  products.slice(0, 10).forEach((p, i) => {
    console.log(`${i+1}. ${p.name} ${p.model_code ? `(${p.model_code})` : ''}`);
  });

  if (products.length > 10) {
    console.log(`... and ${products.length - 10} more`);
  }

  // Add HSN codes
  console.log('\n🔧 Adding HSN codes...');

  const updates = [
    // Push buttons, switches, controls 
    { pattern: /(button|switch|control|relay|snvmpb)/i, hsn: '841900', desc: 'Industrial Controls' },
    // Motors, pumps, compressors  
    { pattern: /(motor|pump|compressor)/i, hsn: '841011', desc: 'Motors & Pumps' },
    // Valves and fittings
    { pattern: /(valve|fitting|pipe)/i, hsn: '848110', desc: 'Valves & Fittings' },
    // Sensors and instruments 
    { pattern: /(sensor|gauge|meter|instrument)/i, hsn: '903289', desc: 'Instruments' },
    // Electrical equipment
    { pattern: /(electrical|cable|wire|panel)/i, hsn: '854449', desc: 'Electrical' },
  ];

  const updateStmt = db.prepare('UPDATE products SET hsn_sac_code = ? WHERE id = ?');
  let updated = 0;

  products.forEach(product => {
    const searchText = `${product.name} ${product.model_code || ''} ${product.product_type || ''}`;
    
    // Find matching HSN
    let hsn = '841900'; // default
    let description = 'Industrial Machinery (Default)';
    
    for (const update of updates) {
      if (update.pattern.test(searchText)) {
        hsn = update.hsn;
        description = update.desc;
        break;
      }
    }
    
    updateStmt.run(hsn, product.id);
    updated++;
    
    console.log(`✅ ${product.name} → ${hsn} (${description})`);
  });

  console.log(`\n🎉 Updated ${updated} products with HSN codes!`);

  // Final check
  const withHsn = db.prepare(`
    SELECT COUNT(*) as count 
    FROM products 
    WHERE is_active = 1 
    AND hsn_sac_code IS NOT NULL 
    AND hsn_sac_code != ''
  `).get();

  console.log(`Total products with HSN codes: ${withHsn.count}`);

  db.close();
  console.log('\n🎯 Done! HSN codes added. Refresh your quotation page to see them.');

} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND') {
    console.log('❌ better-sqlite3 module not found.');
    console.log('\n🔧 Run this instead from your production server:');
    console.log('cd /var/www/lyracore/backend');
    console.log('npm list better-sqlite3  # check if installed');
    console.log('');
    console.log('If not installed, add HSN codes manually through your admin panel:');
    console.log('1. Go to Products section');
    console.log('2. Edit each product');  
    console.log('3. Add HSN code 841900 for industrial machinery/buttons');
  } else {
    console.error('Error:', error.message);
  }
}