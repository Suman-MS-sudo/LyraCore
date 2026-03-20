// Temporary HSN population script that works with your existing backend setup
const express = require('express');
const path = require('path');

// Try to use the same database setup as your main application
try {
  // Import your database module
  const dbPath = path.join(__dirname, 'data', 'lyracore.db');
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  
  console.log('🔌 Database connected successfully');
  
  // Check current products without HSN
  console.log('\n📋 Current products without HSN codes:');
  const productsWithoutHsn = db.prepare(`
    SELECT id, name, model_code, product_type, hsn_sac_code 
    FROM products 
    WHERE is_active = 1 
    AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
  `).all();
  
  console.log(`Found ${productsWithoutHsn.length} products without HSN codes:`);
  productsWithoutHsn.forEach(product => {
    console.log(`- ${product.name} (${product.model_code || 'No model'})`);
  });
  
  if (productsWithoutHsn.length === 0) {
    console.log('✅ All products already have HSN codes!');
    process.exit(0);
  }
  
  // Apply HSN codes
  let updatedCount = 0;
  
  // Push buttons, switches, controls (HSN: 841900)
  const updateButtons = db.prepare(`
    UPDATE products 
    SET hsn_sac_code = '841900' 
    WHERE is_active = 1 
    AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
    AND (
      name LIKE '%button%' OR name LIKE '%switch%' OR 
      name LIKE '%control%' OR name LIKE '%relay%' OR
      model_code LIKE '%SNVMPB%'
    )
  `);
  const buttonsUpdated = updateButtons.run();
  updatedCount += buttonsUpdated.changes;
  console.log(`🔘 Updated ${buttonsUpdated.changes} button/switch/control products`);
  
  // Motors, pumps, compressors (HSN: 841011)
  const updateMotors = db.prepare(`
    UPDATE products 
    SET hsn_sac_code = '841011' 
    WHERE is_active = 1 
    AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
    AND (
      name LIKE '%motor%' OR name LIKE '%pump%' OR name LIKE '%compressor%'
    )
  `);
  const motorsUpdated = updateMotors.run();
  updatedCount += motorsUpdated.changes;
  console.log(`⚙️ Updated ${motorsUpdated.changes} motor/pump/compressor products`);
  
  // Valves and fittings (HSN: 848110)
  const updateValves = db.prepare(`
    UPDATE products 
    SET hsn_sac_code = '848110' 
    WHERE is_active = 1 
    AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
    AND (
      name LIKE '%valve%' OR name LIKE '%fitting%' OR name LIKE '%pipe%'
    )
  `);
  const valvesUpdated = updateValves.run();
  updatedCount += valvesUpdated.changes;
  console.log(`🔧 Updated ${valvesUpdated.changes} valve/fitting/pipe products`);
  
  // Sensors and instruments (HSN: 903289)
  const updateSensors = db.prepare(`
    UPDATE products 
    SET hsn_sac_code = '903289' 
    WHERE is_active = 1 
    AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
    AND (
      name LIKE '%sensor%' OR name LIKE '%gauge%' OR 
      name LIKE '%meter%' OR name LIKE '%instrument%'
    )
  `);
  const sensorsUpdated = updateSensors.run();
  updatedCount += sensorsUpdated.changes;
  console.log(`📊 Updated ${sensorsUpdated.changes} sensor/gauge/meter products`);
  
  // Electrical equipment (HSN: 854449)
  const updateElectrical = db.prepare(`
    UPDATE products 
    SET hsn_sac_code = '854449' 
    WHERE is_active = 1 
    AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
    AND (
      name LIKE '%electrical%' OR name LIKE '%cable%' OR 
      name LIKE '%wire%' OR name LIKE '%panel%'
    )
  `);
  const electricalUpdated = updateElectrical.run();
  updatedCount += electricalUpdated.changes;
  console.log(`⚡ Updated ${electricalUpdated.changes} electrical products`);
  
  // Default HSN code for remaining products (HSN: 841900 - Industrial machinery)
  const updateRemaining = db.prepare(`
    UPDATE products 
    SET hsn_sac_code = '841900' 
    WHERE is_active = 1 
    AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
  `);
  const remainingUpdated = updateRemaining.run();
  updatedCount += remainingUpdated.changes;
  console.log(`🏭 Updated ${remainingUpdated.changes} remaining products with default HSN (841900)`);
  
  // Show summary
  const summary = db.prepare(`
    SELECT 
      COUNT(*) as total_active_products,
      SUM(CASE WHEN hsn_sac_code IS NOT NULL AND hsn_sac_code != '' THEN 1 ELSE 0 END) as products_with_hsn,
      SUM(CASE WHEN hsn_sac_code IS NULL OR hsn_sac_code = '' THEN 1 ELSE 0 END) as products_without_hsn
    FROM products 
    WHERE is_active = 1
  `).get();
  
  console.log('\n📈 Summary:');
  console.log(`✅ Total products updated: ${updatedCount}`);
  console.log(`📦 Total active products: ${summary.total_active_products}`);
  console.log(`✅ Products with HSN codes: ${summary.products_with_hsn}`);
  console.log(`❌ Products without HSN codes: ${summary.products_without_hsn}`);
  
  if (summary.products_without_hsn === 0) {
    console.log('\n🎉 SUCCESS: All products now have HSN codes!');
    console.log('\n📧 Your quotations and invoices will now display HSN codes.');
    console.log('🧪 Test by creating a new quotation in your application.');
  }
  
  db.close();
  console.log('\n💾 Database connection closed.');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  console.log('\n🔧 Alternative solutions:');
  console.log('1. Install sqlite3: sudo apt install sqlite3');
  console.log('2. Or add HSN codes manually through your admin panel');
  console.log('3. Or check if better-sqlite3 is installed: npm install better-sqlite3');
}