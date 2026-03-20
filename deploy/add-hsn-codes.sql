-- SQL script to add HSN codes to products
-- Run this with your backend's database connection

-- First, let's see what products we have
SELECT 'Current products without HSN codes:' as info;
SELECT id, name, model_code, product_type, hsn_sac_code 
FROM products 
WHERE is_active = 1 
AND (hsn_sac_code IS NULL OR hsn_sac_code = '');

-- Add HSN codes based on product types/names
-- Push buttons, switches, controls (HSN: 841900)
UPDATE products 
SET hsn_sac_code = '841900' 
WHERE is_active = 1 
AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
AND (
  name LIKE '%button%' OR name LIKE '%switch%' OR 
  name LIKE '%control%' OR name LIKE '%relay%' OR
  model_code LIKE '%SNVMPB%'
);

-- Motors, pumps, compressors (HSN: 841011)
UPDATE products 
SET hsn_sac_code = '841011' 
WHERE is_active = 1 
AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
AND (
  name LIKE '%motor%' OR name LIKE '%pump%' OR name LIKE '%compressor%'
);

-- Valves and fittings (HSN: 848110)
UPDATE products 
SET hsn_sac_code = '848110' 
WHERE is_active = 1 
AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
AND (
  name LIKE '%valve%' OR name LIKE '%fitting%' OR name LIKE '%pipe%'
);

-- Sensors and instruments (HSN: 903289)
UPDATE products 
SET hsn_sac_code = '903289' 
WHERE is_active = 1 
AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
AND (
  name LIKE '%sensor%' OR name LIKE '%gauge%' OR 
  name LIKE '%meter%' OR name LIKE '%instrument%'
);

-- Electrical equipment (HSN: 854449)
UPDATE products 
SET hsn_sac_code = '854449' 
WHERE is_active = 1 
AND (hsn_sac_code IS NULL OR hsn_sac_code = '')
AND (
  name LIKE '%electrical%' OR name LIKE '%cable%' OR 
  name LIKE '%wire%' OR name LIKE '%panel%'
);

-- Default HSN code for remaining products (HSN: 841900 - Industrial machinery)
UPDATE products 
SET hsn_sac_code = '841900' 
WHERE is_active = 1 
AND (hsn_sac_code IS NULL OR hsn_sac_code = '');

-- Verify the updates
SELECT 'Updated products with HSN codes:' as info;
SELECT id, name, model_code, hsn_sac_code 
FROM products 
WHERE is_active = 1 
ORDER BY name;

-- Summary
SELECT 'Summary:' as info;
SELECT 
  COUNT(*) as total_active_products,
  SUM(CASE WHEN hsn_sac_code IS NOT NULL AND hsn_sac_code != '' THEN 1 ELSE 0 END) as products_with_hsn,
  SUM(CASE WHEN hsn_sac_code IS NULL OR hsn_sac_code = '' THEN 1 ELSE 0 END) as products_without_hsn
FROM products 
WHERE is_active = 1;