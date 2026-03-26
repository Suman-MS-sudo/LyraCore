#!/bin/bash
# Check HSN codes in production database

echo "=== Checking product HSN codes in production database ==="
cd /var/www/lyracore
sqlite3 backend/data/lyracore.db << EOF
SELECT 'Product HSN check:' as info;
SELECT name, model_code, hsn_sac_code, is_active 
FROM products 
WHERE is_active = 1 
LIMIT 10;

SELECT 'Total active products:' as info;
SELECT COUNT(*) as total_active_products FROM products WHERE is_active = 1;

SELECT 'Products with HSN codes:' as info;  
SELECT COUNT(*) as products_with_hsn 
FROM products 
WHERE is_active = 1 AND hsn_sac_code IS NOT NULL AND hsn_sac_code != '';

.quit
EOF